import { ApplicationError } from '../../../shared/kernel';
import type { OrderRepository } from './order-ports';
import type { GroupRepository, ShareReservationRepository } from '../../group-buying/application/group-ports';

export interface AdminOrderQueriesDeps {
  orders: OrderRepository;
  nicknameOf: (userId: string) => Promise<string>;
}

function iso(value: Date): string {
  return value.toISOString();
}

/** 后台订单查询投影：脱敏（无手机号/地址明细），昵称由用户域提供。 */
export class AdminOrderQueries {
  constructor(private readonly deps: AdminOrderQueriesDeps) {}

  async list(query: { status?: unknown; keyword?: unknown; page?: unknown; pageSize?: unknown }) {
    const status = typeof query.status === 'string' && ['unpaid', 'paid', 'cancelled', 'expired'].includes(query.status) ? query.status : null;
    const keyword = typeof query.keyword === 'string' && query.keyword.trim() ? query.keyword.trim() : null;
    const page = typeof query.page === 'number' && Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
    const pageSize = typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 50) : 10;
    const { items, total } = await this.deps.orders.listAdmin({ status, keyword, page, pageSize });
    const rows = await Promise.all(items.map(async (order) => ({
      id: order.state.orderId,
      orderNo: order.state.orderNo,
      status: order.state.status,
      units: order.state.units,
      nickname: await this.deps.nicknameOf(order.state.userId),
      totalAmountFen: order.state.totalAmountFen,
      isFinalOrder: order.state.isFinalOrder,
      createdAt: iso(order.state.createdAt)
    })));
    return { items: rows, page, pageSize, total };
  }

  async get(orderId: unknown) {
    if (typeof orderId !== 'string' || !orderId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const order = await this.deps.orders.findById(orderId);
    if (!order) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const s = order.state;
    return {
      id: s.orderId,
      orderNo: s.orderNo,
      status: s.status,
      units: s.units,
      nickname: await this.deps.nicknameOf(s.userId),
      quote: { totalAmountFen: s.totalAmountFen, goodsAmountFen: s.goodsAmountFen, serviceFeeFen: s.serviceFeeFen, tailAdjustFen: s.tailAdjustFen, isFinalOrder: s.isFinalOrder },
      productSnapshot: { originalPriceFen: s.originalPriceFen, unit: s.unit, wholeQuantityText: s.wholeQuantityText, referenceQuantityText: s.referenceQuantityText },
      addressSummary: { receiverName: s.addressReceiverName, phoneMasked: maskPhone(s.addressPhone), province: s.addressProvince, city: s.addressCity, district: s.addressDistrict },
      reservationExpiresAt: iso(s.reservationExpiresAt),
      createdAt: iso(s.createdAt),
      paidAt: s.paidAt ? iso(s.paidAt) : undefined,
      cancelledAt: s.cancelledAt ? iso(s.cancelledAt) : undefined,
      expiredAt: s.expiredAt ? iso(s.expiredAt) : undefined
    };
  }
}

function maskPhone(phone: string): string {
  if (/^1[3-9]\d{9}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  return phone.length >= 4 ? `****${phone.slice(-4)}` : '****';
}

export interface AdminGroupQueriesDeps {
  groups: GroupRepository;
  reservations: ShareReservationRepository;
  orders: OrderRepository;
  nicknameOf: (userId: string) => Promise<string>;
}

/** 后台拼单组查询投影：容量/快照/成员摘要（订单号+昵称+单位+状态），不暴露手机号与地址。 */
export class AdminGroupQueries {
  constructor(private readonly deps: AdminGroupQueriesDeps) {}

  async list(query: { status?: unknown; productId?: unknown; page?: unknown; pageSize?: unknown }) {
    const status = typeof query.status === 'string' && ['open', 'success', 'failed'].includes(query.status) ? query.status : null;
    const productId = typeof query.productId === 'string' && query.productId ? query.productId : null;
    const page = typeof query.page === 'number' && Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
    const pageSize = typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 50) : 10;
    const { items, total } = await this.deps.groups.listGroups({ status, productId, page, pageSize });
    return {
      items: items.map((group) => this.itemView(group)),
      page,
      pageSize,
      total
    };
  }

  async get(groupId: unknown) {
    if (typeof groupId !== 'string' || !groupId) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
    const group = await this.deps.groups.findById(groupId);
    if (!group) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
    const reservations = await this.deps.reservations.listByGroup(group.state.groupId);
    const members = await Promise.all(reservations.map(async (reservation) => {
      const order = await this.deps.orders.findById(reservation.state.orderId);
      return {
        orderNo: order?.state.orderNo ?? '',
        nickname: order ? await this.deps.nicknameOf(order.state.userId) : '',
        units: reservation.state.units,
        status: reservation.state.status
      };
    }));
    return {
      ...this.itemView(group),
      snapshot: group.state.snapshot,
      deadline: iso(group.state.deadline),
      members
    };
  }

  private itemView(group: { state: { groupId: string; productId: string; status: 'open' | 'success' | 'failed'; paidUnits: number; reservedUnits: number; createdAt: Date; deadline: Date } }) {
    return {
      id: group.state.groupId,
      productId: group.state.productId,
      status: group.state.status,
      paidUnits: group.state.paidUnits,
      reservedUnits: group.state.reservedUnits,
      remainingCapacity: 60 - group.state.paidUnits - group.state.reservedUnits,
      deadline: iso(group.state.deadline),
      createdAt: iso(group.state.createdAt)
    };
  }
}
