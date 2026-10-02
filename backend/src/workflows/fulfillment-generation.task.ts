import type { Clock } from '../shared/kernel';
import { FulfillmentOrder } from '../contexts/fulfillment/domain/fulfillment-order';
import { allocateQuantity, toMinimalUnits } from '../contexts/fulfillment/domain/quantity-allocation';
import type { FulfillmentScanPorts, FulfillmentOrderRepository } from '../contexts/fulfillment/application/ports';

/**
 * 履约单生成任务（T007 F027，D012）：扫描「success 且尚无履约单」的组，按组为事务
 * 为每笔 paid 订单生成履约单（D011 整数克分配）。
 * - 幂等：扫描清单（NOT EXISTS）+ order_id 唯一约束（23505 视为已生成）；
 * - 组级原子：组内任一插入失败整组回滚，下一轮重扫恢复（真实 PG 集成验证）；
 * - 配置错误（整件数量无法换算整数克）：跳过该组并留痕，不阻塞其他组。
 */
export class FulfillmentGenerationTask {
  constructor(private readonly deps: {
    scan: FulfillmentScanPorts;
    fulfillmentOrders: Pick<FulfillmentOrderRepository, 'insert'>;
    runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
    clock: Clock;
  }) {}

  async execute(input: { limit?: number }): Promise<number> {
    const limit = input.limit ?? 20;
    const groupIds = await this.deps.scan.listSuccessGroupIdsWithoutFulfillment(limit);
    let generated = 0;
    for (const groupId of groupIds) {
      try {
        const created = await this.generateForGroup(groupId);
        generated += created > 0 ? 1 : 0;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505') {
          generated += 1; // 并发重复生成：唯一约束兜底，视为已生成
          continue;
        }
        console.error('[fulfillment-gen] 组生成失败，下一轮重试', groupId, error instanceof Error ? error.message : error);
      }
    }
    return generated;
  }

  private async generateForGroup(groupId: string): Promise<number> {
    const snapshot = await this.deps.scan.findGroupSnapshot(groupId);
    if (!snapshot) {
      console.error('[fulfillment-gen] 组不存在或无快照，跳过', groupId);
      return 0;
    }
    // R01（已确认 D011）：按快照单位换算最小履约单位（重量克化/计数整件/未知单位拒绝）
    const minimal = toMinimalUnits(snapshot.wholeQuantityText, snapshot.unit);
    if (minimal === null) {
      await this.deps.scan.recordBlocked(groupId, 'INVALID_QUANTITY');
      console.error('[fulfillment-gen] 整件数量无法按单位换算为最小履约单位，跳过组', groupId, snapshot.wholeQuantityText, snapshot.unit);
      return 0;
    }
    const totalGrams = minimal.units;
    const paidOrders = await this.deps.scan.listPaidByGroup(groupId);
    if (paidOrders.length === 0) {
      console.error('[fulfillment-gen] 成功组无 paid 订单，跳过', groupId);
      return 0;
    }
    // 2026-10-02 复验 P1：计数商品总量 < 订单数（产生零分配）→ 不可拆分配置，
    // 整组暂停并记录异常，保留历史快照，交由审核退款流程；不部分生成、不超发。
    if (totalGrams < paidOrders.length) {
      await this.deps.scan.recordBlocked(groupId, 'ZERO_ALLOCATION');
      console.error('[fulfillment-gen] 整件最小单位数小于订单数（将产生零分配），拒绝生成', groupId, { totalUnits: totalGrams, orders: paidOrders.length });
      return 0;
    }
    const allocations = allocateQuantity(totalGrams, paidOrders.map((o) => ({ orderId: o.orderId, units: o.units })));
    if (allocations.some(a => a.grams <= 0)) {
      await this.deps.scan.recordBlocked(groupId, 'ZERO_ALLOCATION');
      return 0;
    }
    const gramsByOrder = new Map(allocations.map((a) => [a.orderId, a.grams]));
    const now = this.deps.clock.now();
    const created = await this.deps.runner.run(async (sessionTx) => {
      await this.deps.scan.lockGroup?.(groupId,sessionTx);
      let count = 0;
      for (const order of paidOrders) {
        if(await this.deps.scan.isRefundHeld?.(order.orderId,sessionTx))continue;
        const fulfillment = FulfillmentOrder.create({
          groupId,
          orderId: order.orderId,
          userId: order.userId,
          allocatedQuantityGrams: gramsByOrder.get(order.orderId) ?? 0,
          unit: snapshot.unit,
          receiver: {
            name: order.address.receiver_name,
            phone: order.address.phone,
            province: order.address.province,
            city: order.address.city,
            district: order.address.district,
            detail: order.address.detail
          },
          now
        });
        await this.deps.fulfillmentOrders.insert(fulfillment, sessionTx);
        count++;
      }
      return count;
    });
    return created;
  }
}
