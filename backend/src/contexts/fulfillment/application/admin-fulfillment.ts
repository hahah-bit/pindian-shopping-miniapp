import { ApplicationError, type Clock } from '../../../shared/kernel';
import { FulfillmentOrder, type ReceiverSnapshot } from '../domain/fulfillment-order';
import type { FulfillmentOrderRepository } from './ports';
import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(input: unknown, label: string): string {
  if (typeof input !== 'string' || !UUID_PATTERN.test(input)) throw new ApplicationError('VALIDATION_FAILED', `${label}格式无效`);
  return input;
}

export interface FulfillmentAuditPort {
  /** sessionTx：审计与业务同事务写入（R04）——审计失败整体回滚，业务不会"已提交却报错"。 */
  execute(entry: { adminId: string | null; action: string; resourceType: string; resourceId: string; requestId: string | null; detail?: Record<string, unknown> }, sessionTx?: unknown): Promise<void>;
}

export interface AdminFulfillmentDeps {
  fulfillmentOrders: FulfillmentOrderRepository;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
  audit: FulfillmentAuditPort;
}

/** 发货/补发：锁内守恒校验 + 运单唯一（23505 → 409）+ 审计。 */
export class ShipFulfillmentUseCase {
  constructor(private readonly deps: AdminFulfillmentDeps) {}

  async execute(input: {
    fulfillmentId: unknown; quantityGrams: unknown; company: unknown; trackingNo: unknown;
    isReissue: boolean; reason: unknown; adminId: string | null; requestId: string | null;
  }): Promise<{ fulfillmentOrder: FulfillmentOrder; shipmentId: string }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, '履约单 ID');
    const quantityGrams = input.quantityGrams;
    if (!Number.isInteger(quantityGrams) || (quantityGrams as number) <= 0) throw new ApplicationError('VALIDATION_FAILED', '发货数量必须为正整数克');
    const company = typeof input.company === 'string' ? input.company.trim() : '';
    const trackingNo = typeof input.trackingNo === 'string' ? input.trackingNo.trim() : '';
    if (!company || company.length > 30) throw new ApplicationError('VALIDATION_FAILED', '快递公司必填（≤30 字）');
    if (!trackingNo || trackingNo.length > 64) throw new ApplicationError('VALIDATION_FAILED', '运单号必填（≤64 字）');
    if (input.isReissue && (typeof input.reason !== 'string' || !input.reason.trim())) throw new ApplicationError('VALIDATION_FAILED', '补发必须填写原因');

    try {
      // R04：发货、状态与审计同一事务——审计失败整体回滚（不会"已提交却报错"，也不会漏审计）
      const result = await this.deps.runner.run(async (sessionTx) => {
        const fulfillment = await this.deps.fulfillmentOrders.findByIdForUpdate(fulfillmentId, sessionTx);
        if (!fulfillment) throw new ApplicationError('NOT_FOUND', '履约单不存在');
        const { order, entity } = fulfillment.addShipment({
          quantityGrams: quantityGrams as number,
          isReissue: input.isReissue,
          company,
          trackingNo,
          reissueReason: typeof input.reason === 'string' ? input.reason : undefined
        }, this.deps.clock.now());
        await this.deps.fulfillmentOrders.insertShipment(entity, sessionTx);
        await this.deps.fulfillmentOrders.save(order, sessionTx);
        await this.deps.audit.execute({
          adminId: input.adminId,
          action: input.isReissue ? 'fulfillment.reissue' : 'fulfillment.ship',
          resourceType: 'fulfillment_order',
          resourceId: fulfillmentId,
          requestId: input.requestId,
          detail: { shipmentId: entity.shipmentId, quantityGrams: entity.quantityGrams, company, trackingNo, reason: entity.reissueReason ?? undefined }
        }, sessionTx);
        return { order, entity };
      });
      return { fulfillmentOrder: result.order, shipmentId: result.entity.shipmentId };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ApplicationError('SHIPMENT_DUPLICATE_TRACKING', '运单号已存在（快递公司+运单号唯一）');
      }
      throw error;
    }
  }
}

/** 发货前修改收货快照：版本递增 + 审计；发货后锁定（聚合抛 RECEIVER_LOCKED）。 */
export class UpdateReceiverUseCase {
  constructor(private readonly deps: AdminFulfillmentDeps) {}

  async execute(input: { fulfillmentId: unknown; receiver: { name: unknown; phone: unknown; province: unknown; city: unknown; district: unknown; detail: unknown }; adminId: string | null; requestId: string | null }): Promise<{ fulfillmentOrder: FulfillmentOrder }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, '履约单 ID');
    const receiver = input.receiver;
    for (const [key, max] of [['name', 20], ['phone', 20], ['province', 20], ['city', 20], ['district', 20], ['detail', 120]] as const) {
      const value = receiver[key];
      if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApplicationError('VALIDATION_FAILED', `收货信息 ${key} 非法`);
    }
    const result = await this.deps.runner.run(async (sessionTx) => {
      const fulfillment = await this.deps.fulfillmentOrders.findByIdForUpdate(fulfillmentId, sessionTx);
      if (!fulfillment) throw new ApplicationError('NOT_FOUND', '履约单不存在');
      // R06（D013 已确认）：地址锁定 = 存在任何包裹（含补发）——面单/轨迹依赖原地址
      const shipments = await this.deps.fulfillmentOrders.listShipments(fulfillmentId);
      if (shipments.length > 0 || fulfillment.state.shippedQuantityGrams > 0) {
        throw new ApplicationError('RECEIVER_LOCKED', '已存在包裹或发货事实，收货信息已锁定');
      }
      const updated = fulfillment.updateReceiver({
        name: receiver.name as string, phone: receiver.phone as string,
        province: receiver.province as string, city: receiver.city as string,
        district: receiver.district as string, detail: receiver.detail as string
      }, this.deps.clock.now());
      // R04：审计与业务同事务（见 ShipFulfillmentUseCase）
      await this.deps.fulfillmentOrders.save(updated, sessionTx);
      await this.deps.audit.execute({ adminId: input.adminId, action: 'fulfillment.receiver_update', resourceType: 'fulfillment_order', resourceId: fulfillmentId, requestId: input.requestId, detail: { fromVersion: fulfillment.state.receiver.version, toVersion: fulfillment.state.receiver.version + 1 } }, sessionTx);
      return updated;
    });
    return { fulfillmentOrder: result };
  }
}

/** 完成：仅 shipped；终态幂等；completed_by=admin + 审计。 */
export class CompleteFulfillmentUseCase {
  constructor(private readonly deps: AdminFulfillmentDeps) {}

  async execute(input: { fulfillmentId: unknown; by: 'user' | 'admin'; adminId?: string | null; requestId: string | null }): Promise<{ fulfillmentOrder: FulfillmentOrder }> {
    const fulfillmentId = requireUuid(input.fulfillmentId, '履约单 ID');
    const result = await this.deps.runner.run(async (sessionTx) => {
      const fulfillment = await this.deps.fulfillmentOrders.findByIdForUpdate(fulfillmentId, sessionTx);
      if (!fulfillment) throw new ApplicationError('NOT_FOUND', '履约单不存在');
      const completed = fulfillment.markCompleted(input.by, this.deps.clock.now());
      if (completed !== fulfillment) {
        await this.deps.fulfillmentOrders.save(completed, sessionTx);
        if (input.by === 'admin') {
          // R04：审计与业务同事务
          await this.deps.audit.execute({
            adminId: input.adminId ?? null,
            action: 'fulfillment.complete',
            resourceType: 'fulfillment_order',
            resourceId: fulfillmentId,
            requestId: input.requestId,
            detail: { completedBy: 'admin' }
          }, sessionTx);
        }
      }
      return completed;
    });
    return { fulfillmentOrder: result };
  }
}

export { randomUUID };
export type { ReceiverSnapshot };
