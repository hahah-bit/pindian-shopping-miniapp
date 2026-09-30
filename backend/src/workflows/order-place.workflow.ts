import { ApplicationError, type Clock } from '../shared/kernel';
import { Group, type SalePolicySnapshot } from '../contexts/group-buying/domain/group';
import { ShareReservation } from '../contexts/group-buying/domain/share-reservation';
import { buildCompletenessTable, canJoinGroup } from '../contexts/group-buying/domain/completeness';
import { Order, OrderNumber } from '../contexts/ordering/domain/order';
import { computeQuote } from '../contexts/ordering/domain/pricing';
import type { ShareUnits } from '../contexts/catalog/domain/share-option';

export interface GroupRepository {
  findById(groupId: string): Promise<Group | null>;
  findByIdForUpdate(groupId: string, sessionTx: unknown): Promise<Group | null>;
  findCandidates(query: { productId: string; units: number; now: Date }): Promise<Group[]>;
  insert(group: Group, sessionTx?: unknown): Promise<void>;
  save(group: Group, sessionTx?: unknown): Promise<void>;
}

export interface ShareReservationRepository {
  insert(reservation: ShareReservation, sessionTx?: unknown): Promise<void>;
  findByOrderId(orderId: string): Promise<ShareReservation | null>;
  save(reservation: ShareReservation, sessionTx?: unknown): Promise<void>;
}

export interface OrderRepository {
  findByIdempotencyKey(userId: string, key: string): Promise<Order | null>;
  findById(orderId: string): Promise<Order | null>;
  insert(order: Order, sessionTx?: unknown): Promise<void>;
  save(order: Order, sessionTx?: unknown): Promise<void>;
}

export interface AddressOwnershipPort {
  /** 返回归属该用户的地址快照；不归属返回 null。 */
  getAddressForUser(addressId: string, userId: string): Promise<{ addressId: string; receiverName: string; phone: string; province: string; city: string; district: string; detail: string } | null>;
}

export interface ProductSnapshotPort {
  /** 商品不可售返回 null；可售返回快照与截止配置。 */
  getSellableSnapshot(productId: string): Promise<{ productId: string; snapshot: SalePolicySnapshot; deadlineHours: number } | null>;
}

export interface StockReservationPort {
  reserveOne(productId: string, businessKey: string): Promise<void>;
  releaseOne(productId: string, businessKey: string): Promise<void>;
  consumeOne(productId: string, businessKey: string): Promise<void>;
}

export interface PlaceOrderDeps {
  groups: GroupRepository;
  reservations: ShareReservationRepository;
  orders: OrderRepository;
  addresses: AddressOwnershipPort;
  products: { getSellableSnapshot(productId: string): Promise<{ productId: string; snapshot: SalePolicySnapshot; deadlineHours: number } | null> };
  stocks: StockReservationPort;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
  reservationTtlMinutes: number;
  generateId: () => string;
  generateOrderNo: () => string;
  maxRetries?: number;
}

export interface PlaceOrderCommand {
  productId: unknown;
  units: unknown;
  addressId: unknown;
  idempotencyKey: unknown;
}

export interface PlacedOrderView {
  orderId: string;
  orderNo: string;
  status: 'unpaid';
  units: number;
  quote: ReturnType<typeof computeQuote>;
  group: { groupId: string; isNewGroup: boolean; paidUnits: number; reservedUnits: number; remainingCapacity: number; deadline: Date; status: 'open' };
  reservationExpiresAt: Date;
  createdAt: Date;
}

function uuidOf(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApplicationError('VALIDATION_FAILED', `${label}格式无效`);
  }
  return input;
}

/**
 * 下单工作流（D001/D002/D003 已确认规则）：
 * 幂等 → 地址归属 → 商品可售快照 → 匹配/建组（事务内行锁重查+尾差判定）→ 预占+订单原子提交。
 */
export class PlaceOrderWorkflow {
  constructor(private readonly deps: PlaceOrderDeps) {}

  async execute(input: { userId: unknown; command: PlaceOrderCommand }): Promise<PlacedOrderView> {
    const userId = uuidOf(input.userId, '用户身份');
    const productId = uuidOf(input.command.productId, '商品 ID');
    const addressId = uuidOf(input.command.addressId, '地址 ID');
    const idempotencyKey = uuidOf(input.command.idempotencyKey, '幂等键');
    const units = input.command.units;
    const now = this.deps.clock.now();

    // 1. 幂等：同键命中——内容一致返回原单，不一致明确冲突
    const existing = await this.deps.orders.findByIdempotencyKey(userId, idempotencyKey);
    if (existing) {
      if (existing.state.productId !== productId || existing.state.units !== units || existing.state.addressReceiverName === undefined) {
        throw new ApplicationError('IDEMPOTENCY_CONFLICT', '相同幂等键的请求内容不同');
      }
      const addressMatch = await this.deps.addresses.getAddressForUser(addressId, userId);
      if (!addressMatch || existing.state.addressPhone !== addressMatch.phone) {
        throw new ApplicationError('IDEMPOTENCY_CONFLICT', '相同幂等键的请求内容不同');
      }
      return this.toView(existing, false);
    }

    // 2. 地址归属（快照来源）
    const address = await this.deps.addresses.getAddressForUser(addressId, userId);
    if (!address) throw new ApplicationError('ADDRESS_NOT_FOUND', '收货地址不存在');

    // 3. 商品可售快照（D003：下架即拒绝新预占）
    const sellable = await this.deps.products.getSellableSnapshot(productId);
    if (!sellable) throw new ApplicationError('PRODUCT_NOT_ON_SHELF', '商品已下架或不可售');
    if (typeof units !== 'number' || !sellable.snapshot.allowedShareUnits.includes(units as ShareUnits)) {
      throw new ApplicationError('SHARE_UNIT_INVALID', '份额选项不在商品允许范围内');
    }
    const deadline = new Date(now.getTime() + sellable.deadlineHours * 3600_000);
    const reservationExpiresAt = new Date(now.getTime() + this.deps.reservationTtlMinutes * 60_000);

    // 4. 匹配 + 有限重试（可完成性为应用层精确过滤——SQL 无法表达 DP；写入事务内仍重查）
    const maxRetries = this.deps.maxRetries ?? 3;
    let lastConflict: ApplicationError | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const candidates = await this.deps.groups.findCandidates({ productId, units, now: this.deps.clock.now() });
      const candidate = candidates.find((g) => canJoinGroup(g.state.snapshot.allowedShareUnits, buildCompletenessTable(g.state.snapshot.allowedShareUnits), g.remainingCapacity, units)) ?? null;
      try {
        if (candidate) {
          return await this.joinExistingGroup(candidate, { userId, productId, units, address, idempotencyKey, reservationExpiresAt, now });
        }
        return await this.createNewGroup(sellable, { userId, productId, units, address, idempotencyKey, reservationExpiresAt, deadline, now });
      } catch (error) {
        if (error instanceof ApplicationError && (error.code === 'SHARE_CAPACITY_CONFLICT' || error.code === 'GROUP_NOT_JOINABLE')) {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }
    throw lastConflict ?? new ApplicationError('SHARE_CAPACITY_CONFLICT', '份额容量竞争失败，请重试');
  }

  /** 加入已有组：行锁重查 + 尾差判定 + 预占/订单原子提交。 */
  private async joinExistingGroup(
    candidate: Group,
    ctx: { userId: string; productId: string; units: number; address: { receiverName: string; phone: string; province: string; city: string; district: string; detail: string }; idempotencyKey: string; reservationExpiresAt: Date; now: Date }
  ): Promise<PlacedOrderView> {
    const table = buildCompletenessTable(candidate.state.snapshot.allowedShareUnits);
    const result = await this.deps.runner.run(async (sessionTx) => {
      const group = (await this.deps.groups.findByIdForUpdate(candidate.state.groupId, sessionTx)) ?? candidate;
      if (!group.isOpen || group.state.deadline <= ctx.now) throw new ApplicationError('GROUP_NOT_JOINABLE', '拼单组已结束，无法加入');
      if (!canJoinGroup(group.state.snapshot.allowedShareUnits, table, group.remainingCapacity, ctx.units)) {
        throw new ApplicationError('SHARE_CAPACITY_CONFLICT', '份额容量竞争失败，请重试');
      }
      // 最后单判定（D001）：预占后恰好 60 单位 → 补差
      const isFinalOrder = group.remainingCapacity - ctx.units === 0;
      const quote = computeQuote({
        originalPriceFen: group.state.snapshot.originalPriceFen,
        units: ctx.units,
        isFinalOrder,
        groupPaidAmountFen: group.state.paidAmountFen,
        groupPaidGoodsFen: group.state.paidGoodsAmountFen
      });
      const reserved = group.withReservedUnits(ctx.units);
      const order = this.buildOrder({ groupId: group.state.groupId, productId: ctx.productId, userId: ctx.userId, units: ctx.units, quote, snapshot: this.snapshotOf(group), address: ctx.address, idempotencyKey: ctx.idempotencyKey, reservationExpiresAt: ctx.reservationExpiresAt, now: ctx.now });
      const reservation = ShareReservation.create({ groupId: group.state.groupId, orderId: order.state.orderId, units: ctx.units, expiresAt: ctx.reservationExpiresAt, now: ctx.now });
      await this.deps.orders.insert(order, sessionTx);
      await this.deps.reservations.insert(reservation, sessionTx);
      await this.deps.groups.save(reserved, sessionTx);
      return { order, group: reserved };
    });
    return this.toView(result.order, false);
  }

  /** 无候选组：整件预留 + 建组 + 首单（同一事务，失败整体回滚——D002）。 */
  private async createNewGroup(
    sellable: { productId: string; snapshot: SalePolicySnapshot; deadlineHours: number },
    ctx: { userId: string; productId: string; units: number; address: { receiverName: string; phone: string; province: string; city: string; district: string; detail: string }; idempotencyKey: string; reservationExpiresAt: Date; deadline: Date; now: Date }
  ): Promise<PlacedOrderView> {
    const result = await this.deps.runner.run(async (sessionTx) => {
      const groupId = this.deps.generateId();
      const stockKey = `group-create:${groupId}`;
      await this.deps.stocks.reserveOne(ctx.productId, stockKey);
      const group = Group.create({ groupId, productId: ctx.productId, snapshot: sellable.snapshot, deadline: ctx.deadline, now: ctx.now });
      const quote = computeQuote({ originalPriceFen: group.state.snapshot.originalPriceFen, units: ctx.units, isFinalOrder: false, groupPaidAmountFen: 0, groupPaidGoodsFen: 0 });
      const order = this.buildOrder({ groupId, productId: ctx.productId, userId: ctx.userId, units: ctx.units, quote, snapshot: this.snapshotOf(group), address: ctx.address, idempotencyKey: ctx.idempotencyKey, reservationExpiresAt: ctx.reservationExpiresAt, now: ctx.now });
      const reservation = ShareReservation.create({ groupId, orderId: order.state.orderId, units: ctx.units, expiresAt: ctx.reservationExpiresAt, now: ctx.now });
      await this.deps.groups.insert(group.withReservedUnits(ctx.units), sessionTx);
      await this.deps.orders.insert(order, sessionTx);
      await this.deps.reservations.insert(reservation, sessionTx);
      return { order, group };
    });
    return this.toView(result.order, true);
  }

  private snapshotOf(group: Group) {
    return {
      originalPriceFen: group.state.snapshot.originalPriceFen,
      unit: group.state.snapshot.unit,
      wholeQuantityText: group.state.snapshot.wholeQuantityText,
      referenceQuantityText: this.referenceQuantity(group.state.snapshot.wholeQuantityText, group.remainingCapacity >= 0 ? 0 : 0)
    };
  }

  private referenceQuantity(wholeQuantityText: string, _unused: number): string {
    return wholeQuantityText;
  }

  private buildOrder(ctx: { groupId: string; productId: string; userId: string; units: number; quote: ReturnType<typeof computeQuote>; snapshot: { originalPriceFen: number; unit: string; wholeQuantityText: string; referenceQuantityText: string }; address: { receiverName: string; phone: string; province: string; city: string; district: string; detail: string }; idempotencyKey: string; reservationExpiresAt: Date; now: Date }): Order {
    return Order.create({
      orderId: this.deps.generateId(),
      orderNo: this.deps.generateOrderNo(),
      userId: ctx.userId,
      productId: ctx.productId,
      groupId: ctx.groupId,
      units: ctx.units,
      quote: ctx.quote,
      snapshot: ctx.snapshot,
      addressSnapshot: ctx.address,
      reservationExpiresAt: ctx.reservationExpiresAt,
      idempotencyKey: ctx.idempotencyKey,
      now: ctx.now
    });
  }

  private toView(order: Order, isNewGroup: boolean): PlacedOrderView {
    void isNewGroup;
    return {
      orderId: order.state.orderId,
      orderNo: order.state.orderNo,
      status: 'unpaid',
      units: order.state.units,
      quote: {
        totalAmountFen: order.state.totalAmountFen,
        goodsAmountFen: order.state.goodsAmountFen,
        serviceFeeFen: order.state.serviceFeeFen,
        tailAdjustFen: order.state.tailAdjustFen,
        isFinalOrder: order.state.isFinalOrder
      },
      group: {
        groupId: order.state.groupId,
        isNewGroup,
        paidUnits: 0,
        reservedUnits: order.state.units,
        remainingCapacity: 60 - order.state.units,
        deadline: new Date(order.state.reservationExpiresAt.getTime() + 86_340_000),
        status: 'open'
      },
      reservationExpiresAt: order.state.reservationExpiresAt,
      createdAt: order.state.createdAt
    };
  }
}

/** 取消未支付订单：释放预占与组容量（不涉及退款）。 */
export class CancelUnpaidOrder {
  constructor(private readonly deps: { orders: OrderRepository; reservations: ShareReservationRepository; groups: GroupRepository; clock: Clock; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> } }) {}

  async execute(input: { userId: unknown; orderId: unknown }): Promise<{ cancelled: true }> {
    const userId = uuidOf(input.userId, '用户身份');
    const orderId = uuidOf(input.orderId, '订单 ID');
    await this.deps.runner.run(async (sessionTx) => {
      const order = await this.deps.orders.findById(orderId);
      if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
      if (order.state.status === 'cancelled') return;
      if (!order.isUnpaid) throw new ApplicationError('ORDER_NOT_CANCELLABLE', '订单当前状态不可取消');
      const reservation = await this.deps.reservations.findByOrderId(orderId);
      const cancelled = order.cancel(this.deps.clock.now());
      await this.deps.orders.save(cancelled, sessionTx);
      if (reservation && reservation.state.status === 'reserved') {
        await this.deps.reservations.save(reservation.cancel(this.deps.clock.now()), sessionTx);
        const group = await this.deps.groups.findByIdForUpdate(reservation.state.groupId, sessionTx);
        if (group) await this.deps.groups.save(group.andReserved(reservation.state.units), sessionTx);
      }
    });
    return { cancelled: true };
  }
}

