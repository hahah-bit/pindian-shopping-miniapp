# F008 实际验收记录

日期：2026-09-30。结论：代码与接口层验收通过；**微信开发者工具/真机未验证**（环境限制，见未验证项）。

## 测试证据

| 验证 | 命令/操作 | 结果 |
| --- | --- | --- |
| 类型检查 | npm run typecheck -w @pindian/mini-program | 通过 |
| 页面注册 | tests/task-suites/t001/frontend-contract.test.mjs（全量内自动执行） | 通过：app.json 注册页四件套存在、tabBar 一致（新增 detail 页已注册） |
| 金额格式化 | tests/task-suites/t002/mini-format.test.mjs | formatFen 整数分→"x.xx" 字符串运算：0/5/50500/10100/16833/负数/上限正确，无浮点 |
| 真实接口渲染数据 | curl（与页面同一契约） | 列表返回上架商品（mainImageUrl 绝对地址、priceFromFen、stockStatus）；详情含 shareOptions 四档（数量/参考价）；不存在商品 404（页面将显示"商品已下架或不存在"）；停 API 时 httpGet 抛 NETWORK_ERROR（页面显示失败态+重试） |
| Mock 标注 | 代码审查 + 数据同构 | mock 模式顶部显示"Mock 数据预览"横幅；api 模式（默认）无 Mock 标注 |
| 无越界业务元素 | 代码审查 | 无下单/支付按钮；底部固定"拼单购买暂未开放"；无拼单进度/参与人数/销量展示；份额价标注"参考" |

## 未验证（环境限制，如实记录）

- **微信开发者工具编译与真机预览未执行**：touristappid 无真实身份能力；图片实际渲染、下拉刷新手势、轮播交互需在开发者工具中人工验证。AC-F08-8 部分未覆盖。
- 真机需要可访问的 HTTPS 域名并配置微信合法域名；本地 127.0.0.1:3000 仅适用于开发者工具联调。
