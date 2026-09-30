# F015 报价、订单创建与份额预占 DDD

复用 [T004 ddd](../../tasks/T004-group-order-reservation/ddd.md) §3.1–3.3、§4.3、§6.1/6.2/6.4，决策 [D001](../../tasks/T004-group-order-reservation/decisions/D001-pricing-tail-difference.md)/[D003](../../tasks/T004-group-order-reservation/decisions/D003-config-change.md)。

## QuotePricing（Ordering 领域纯函数）

- 通用价：standard = half-up(whole×units/60)；goods = half-up(P×units/60)；service = standard − goods。
- 最后单：total = whole − groupPaidAmountFen；goods = P − groupPaidGoodsFen；tail = total − standard；service = total − goods。
- 不变量：total ≥ 0；组成功时 Σtotal=whole、Σgoods=P、Σservice=500。

## PlaceOrderWorkflow（编排）

1. 幂等：同 (userId,key) 命中 → 内容一致返回原单 / 不一致 409。
2. 地址归属（AddressRepository.findById(id, userId)）。
3. 商品可售快照（Catalog 能力，on_shelf 检查）。
4. 匹配（GroupBuying 纯读）→ 无候选则建组（库存预留同事务）。
5. 事务：组行锁重查（容量/deadline/status/可完成性）→ 尾差判定 → 预占 + 组容量更新 + 订单创建。
6. 竞争失败有限重试（3 次）→ SHARE_CAPACITY_CONFLICT。
