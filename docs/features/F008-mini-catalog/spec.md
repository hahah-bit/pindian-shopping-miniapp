# F008 spec

上游：[T002 spec](../../tasks/T002-catalog-admin-media/spec.md) §3.4（S14–S16）、§5（小程序交互状态）、§8 AC08。接口契约见 F007 spec「接口契约细节」mini 部分。

## 页面行为细则

### 列表页 `features/catalog/pages/index`

- 首次进入自动加载第 1 页（pageSize 10）；下拉刷新重置列表；触底加载下一页，无更多显示“没有更多了”。
- 商品卡片：主图（`binderror` 占位）、名称、`userWholePriceFen` 展示“整件 ¥x.xx”、`priceFromFen` 展示“¥x.xx/份 起”、库存徽标（有货/已售罄）。
- 状态：加载中（提示文字）、空（“暂无在售商品”+重试按钮）、失败（错误消息 + 重试按钮）；mock 模式顶部条标注“Mock 数据预览”。
- 点击卡片 → `wx.navigateTo` 详情页 `features/catalog/pages/detail/index?id=`。

### 详情页 `features/catalog/pages/detail`

- 参数 `id`；加载中/失败重试/404（“商品已下架或不存在”）状态。
- 轮播：`[mainImageUrl, ...detailImageUrls]`（去重保序），`binderror` 占位。
- 信息区：名称、描述、`整件数量 + 单位`（如“10 斤/件”）、整件参考价（含“含 500 分服务费”说明）、份额卡片列表（`fractionLabel`（如 1/3）、`quantityText + unit`、参考价，标注“参考价，实际以拼单开放后报价为准”）。
- 库存状态徽标；底部固定说明“拼单购买暂未开放，敬请期待”（不可点击）。
- 金额展示统一 `formatFen`（字符串运算）。

## 数据与配置

- `platform/config.ts`：默认 `mode: 'api'`、`baseUrl: 'http://127.0.0.1:3000'`；注释说明真机需 HTTPS 域名。mock 数据与契约同构、标注来源。
- `platform/http.ts`：统一 wx.request 封装（超时、envelope 解包、错误对象带 code/message）；不吞错伪装成功。
- 页面注册：`app.json` pages 增加 `features/catalog/pages/detail/index`；tabBar 不变。

## 验收条件

- AC-F08-1 类型检查通过（`npm run typecheck -w @pindian/mini-program`）；页面配置测试通过（注册页面四件套存在）。
- AC-F08-2 列表/详情在真实后端有上架商品时正确渲染（集成环境实际请求验证，含分页与图片 URL 可访问）。
- AC-F08-3 空态/失败态/重试可用（api 模式停 API 验证失败态；空库验证空态）。
- AC-F08-4 下架商品详情显示不可售提示（404 路径）。
- AC-F08-5 图片加载失败占位不破坏布局。
- AC-F08-6 mock 模式明确标注且数据契约同构；api 模式不显示 Mock 标注。
- AC-F08-7 无下单/支付/进度/参与人数等未实现业务元素（代码审查）。
- AC-F08-8 开发者工具/真机验证：环境不具备时如实记录未验证（不伪造）。
