import { ApplicationError } from '../../../shared/kernel';
export interface CardProjectionDeps {
  listOptions(userId: string, kind: string): Promise<Array<{id:string;label:string}>>;
  product: { findById(id: string): Promise<{ state: { productId: string; name: string; status: string; unit: string; originalPriceFen: number; wholeQuantityText: string; images: Array<{ role: string; mediaId: string }> } } | null> };
  orders: { findById(id: string): Promise<{ state: { orderId: string; userId: string; orderNo: string; status: string; units: number; totalAmountFen: number; createdAt: Date } } | null> };
  groups: { findById(id: string): Promise<{ state: { groupId: string; status: string; paidUnits: number; snapshot: { unit: string; wholeQuantityText: string } } } | null> };
  orderBelongsTo: { findByGroupId(groupId: string): Promise<Array<{ state: { userId: string } }>> };
  payments: { findByOrderId(orderId: string): Promise<{ state: { amountFen: number } } | null> };
  refunds: { findByOrderId(orderId: string): Promise<Array<{ state: { status: string; amountFen: number; createdAt: Date } }>> };
}
/** 读取与发送卡片共用授权投影，客服以接待用户身份检查引用。 */
export class CardProjectionUseCase {
  constructor(private readonly deps: CardProjectionDeps) {}
  async options(userId:string,kind:string):Promise<Array<{id:string;label:string}>> {
    if(!['product','order','group','refund'].includes(kind))throw new ApplicationError('VALIDATION_FAILED','卡片类型非法');
    return this.deps.listOptions(userId,kind);
  }
  async execute(userId: string, kind: string, id: string): Promise<Record<string, unknown>> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ApplicationError('VALIDATION_FAILED', '卡片引用非法');
    if (kind === 'product') {
      const product = await this.deps.product.findById(id);
      if (!product || product.state.status !== 'on_shelf') throw new ApplicationError('NOT_FOUND', '商品不存在或未上架');
      const s = product.state;
      return { product: { id: s.productId, name: s.name, unit: s.unit, originalPriceFen: s.originalPriceFen, wholeQuantityText: s.wholeQuantityText, mainImageId: s.images.find(i => i.role === 'main')?.mediaId ?? null } };
    }
    if (kind === 'group') {
      const group = await this.deps.groups.findById(id);
      if (!group || !(await this.deps.orderBelongsTo.findByGroupId(id)).some(m => m.state.userId === userId)) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
      const s = group.state;
      return { group: { id: s.groupId, status: s.status, paidUnits: s.paidUnits, unit: s.snapshot.unit, wholeQuantityText: s.snapshot.wholeQuantityText } };
    }
    if (kind !== 'order' && kind !== 'refund') throw new ApplicationError('VALIDATION_FAILED', '卡片类型非法');
    const order = await this.deps.orders.findById(id);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const s = order.state;
    if (kind === 'order') return { order: { id: s.orderId, orderNo: s.orderNo, status: s.status, units: s.units, totalAmountFen: s.totalAmountFen, createdAt: s.createdAt.toISOString() } };
    const refunds = await this.deps.refunds.findByOrderId(id);
    const payment = await this.deps.payments.findByOrderId(id);
    return { refund: { orderId: id, paidAmountFen: payment?.state.amountFen ?? 0, items: refunds.map(r => ({ status: r.state.status, amountFen: r.state.amountFen, createdAt: r.state.createdAt.toISOString() })) } };
  }
}
