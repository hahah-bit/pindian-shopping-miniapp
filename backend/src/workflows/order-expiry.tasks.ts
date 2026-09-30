import type { Clock } from '../shared/kernel';
import type { GroupRepository, ShareReservationRepository } from '../contexts/group-buying/application/group-ports';
import type { OrderRepository } from '../contexts/ordering/application/order-ports';
import type { StockReservationPort } from './order-place.workflow';

export interface ExpiryTaskDeps {
  groups: GroupRepository;
  reservations: ShareReservationRepository;
  orders: OrderRepository;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/**
 * 预占过期任务：到期预占 → expired；组容量回落；订单 unpaid → expired。
 * SKIP LOCKED + 状态条件更新：多实例/重复执行/重启后均幂等（D004）。
 */
export class ExpireReservationsTask {
  constructor(private readonly deps: ExpiryTaskDeps) {}

  async execute(input: { limit?: number }): Promise<number> {
    const limit = input.limit ?? 100;
    const now = this.deps.clock.now();
    const expired = await this.deps.reservations.findExpired(now, limit);
    let processed = 0;
    for (const reservation of expired) {
      try {
        await this.deps.runner.run(async (sessionTx) => {
          const closed = reservation.expire(now);
          if (closed === reservation) return; // 已被并发处理
          const order = await this.deps.orders.findById(reservation.state.orderId);
          await this.deps.reservations.save(closed, sessionTx);
          const group = await this.deps.groups.findByIdForUpdate(reservation.state.groupId, sessionTx);
          if (group) await this.deps.groups.save(group.andReserved(reservation.state.units), sessionTx);
          if (order && order.isUnpaid) await this.deps.orders.save(order.markExpired(now), sessionTx);
        });
        processed++;
      } catch (error) {
        console.error('[order-expiry] 预占过期处理失败', reservation.state.reservationId, error instanceof Error ? error.message : error);
      }
    }
    return processed;
  }
}

/**
 * 组截止任务：open 且 deadline 已过 → 组内残留预占/订单过期 → 组 failed → 整件库存释放。
 * 已支付订单保持 paid（退款属支付阶段边界，D005）。
 */
export class FailDeadlineGroupsTask {
  constructor(private readonly deps: ExpiryTaskDeps & { stocks: StockReservationPort }) {}

  async execute(input: { limit?: number }): Promise<number> {
    const limit = input.limit ?? 100;
    const now = this.deps.clock.now();
    const groups = await this.deps.groups.findExpiredOpenGroups(now, limit);
    let processed = 0;
    for (const group of groups) {
      try {
        const released = await this.deps.runner.run(async (sessionTx) => {
          const locked = await this.deps.groups.findByIdForUpdate(group.state.groupId, sessionTx);
          if (!locked || !locked.isOpen || locked.state.deadline > now) return false;
          for (const reservation of await this.deps.reservations.listByGroup(locked.state.groupId)) {
            if (reservation.state.status !== 'reserved') continue;
            await this.deps.reservations.save(reservation.expire(now), sessionTx);
            await this.deps.orders.transitionIfUnpaid?.(reservation.state.orderId, 'expired', now, sessionTx);
          }
          const failed = locked.markFailed(now);
          await this.deps.groups.save(failed, sessionTx);
          await this.deps.stocks.releaseOne(failed.state.productId, `group-release:${failed.state.groupId}`);
          return true;
        });
        if (released) processed++;
      } catch (error) {
        console.error('[order-expiry] 组截止处理失败', group.state.groupId, error instanceof Error ? error.message : error);
      }
    }
    return processed;
  }
}
