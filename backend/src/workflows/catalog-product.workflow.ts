import type { Clock, TransactionRunner } from '../shared/kernel';
import type { CreateProductDraft } from '../contexts/catalog/application/product-use-cases';
import type { ProductRepository } from '../contexts/catalog/application/ports';
import type { StockRepository } from '../contexts/inventory/application/ports';
import { Stock, StockMovement } from '../contexts/inventory/domain/stock';

/**
 * 创建商品工作流（跨 Catalog + Inventory）：
 * 商品与初始库存必须在同一数据库事务内提交，任一失败整体回滚（同生同灭）。
 */
export class CreateProductWorkflow {
  constructor(private readonly deps: {
    createDraft: CreateProductDraft;
    products: ProductRepository;
    stocks: StockRepository;
    runner: TransactionRunner;
    clock: Clock;
  }) {}

  async execute(input: { input: Record<string, unknown>; actorAdminId: string | null }): Promise<{ productId: string }> {
    const draft = await this.deps.createDraft.execute(input.input);
    const now = this.deps.clock.now();
    const stock = Stock.initialize(draft.state.productId, (input.input as { initialStockWholeItems?: unknown }).initialStockWholeItems, now);
    const movement = stock.state.availableWholeItems > 0
      ? StockMovement.create({
          movementId: crypto.randomUUID(),
          productId: draft.state.productId,
          delta: stock.state.availableWholeItems,
          resultingAvailable: stock.state.availableWholeItems,
          reason: '创建商品初始化库存',
          actorAdminId: input.actorAdminId,
          requestId: null,
          createdAt: now
        })
      : null;
    await this.deps.runner.run(async (session) => {
      await this.deps.products.save(draft, session);
      await this.deps.stocks.initialize(stock, movement, session);
    });
    return { productId: draft.state.productId };
  }
}

/**
 * 上架工作流：读取 Inventory 库存事实后由 Catalog 判定条件。
 * 两步非原子：上架后库存被调整为 0 是合法业务序列（展示为已售罄）。
 */
export class PublishProductWorkflow {
  constructor(private readonly deps: {
    stocks: Pick<StockRepository, 'findById'>;
    publish: { execute(input: { productId: unknown; stockAvailableWholeItems: number | null }): Promise<unknown> };
  }) {}

  async execute(input: { productId: unknown }): Promise<unknown> {
    const productId = typeof input.productId === 'string' ? input.productId : '';
    const stock = productId ? await this.deps.stocks.findById(productId) : null;
    return this.deps.publish.execute({
      productId: input.productId,
      stockAvailableWholeItems: stock ? stock.state.availableWholeItems : null
    });
  }
}
