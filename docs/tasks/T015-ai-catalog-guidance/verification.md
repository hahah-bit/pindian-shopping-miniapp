# T015 验证记录

日期2026-10-06，Windows本机；已完成本轮本地范围。无真实资金、无公网部署；安卓真机尚未验。

## 先失败与专项

- 初始 `node --test tests/task-suites/t015/pi-guidance.test.mjs`：4/4目标行为失败（缺少导购工具/结构化结果/页面卡片入口），随后实现。日志 `.git/design-references/t015-red.log`。
- 工具后HTTP失败不隐式重试用例是后续正向补充；第一次运行1/1通过，不记为RED。显式设置Pi maxRetries=0、单次1200tokens及30s超时，保留整条30s应用超时。
- 首次专项22条中21通过，详情加载用例失败：测试断言先纠正为实际页面扁平DTO，随后发现测试装置缺少原生wx.setNavigationBarTitle，补齐平台接口后实际详情加载通过。生产详情页面未修改，不以去掉错误断言掩盖故障。
- 首次完整实现 `npm run test:task:t015`：23/23通过，0失败/跳过。分类检索修订后最终专项24/24，新增导购测试11条，原F051六条及T014七条，注册目录明确。先构建/架构检查，然后任务专项；最终日志 `.git/design-references/t015-task-final.log`。
- 本轮真实HTTP/PG与Pi受控SSE测试覆盖上架/下架/售罄/草稿过滤、详情竞态复查、意图、空结果、一般问答、工具/查询参数/循环限额、错误脱敏、本人隔离、同租约原子快照、失败清空、重放/分页/仓储重建恢复和实际页面详情请求；受控模型不等于真实DeepSeek理解验收。

## 真实本地联调与原生界面

- `docker compose up -d --build api worker --wait --wait-timeout 180` exit0，API/Worker/Postgres均healthy；0031加法迁移通过现有启动流程装配，保留已有轮次general/[]默认值。日志 `.git/design-references/t015-deploy.log`。
- 微信开发者工具官方CLI auto + miniprogram-automator检查实际原生页面；本人已有微信会话，真实项目API/PG、已配置DeepSeek官方接口。
- 问“有推荐的咖啡么？请简洁回答。”：product_recommendation/completed，卡片`[体验] 咖啡豆`，参考份额价2060分；实际点击进入目录详情，ID及名称一致，无加载错误。
- 返回客服后历史卡片仍在；问“介绍一下咖啡商品，有什么可以看？请简短回答。”：product_introduction/completed，介绍基于公开商品记录，同款可点击卡片。
- 返回后的卡片恢复由原生自动化读取本人消息并检查原clientMessageId下cards存在，以及独立HTTP/PG恢复用例确认；恢复截图的当前视窗没有完整卡片，单张截图不作为该行为的独立证明。
- 另用真实DeepSeek发送自然需求“办公室想备点饼干类零食，有哪些产品可以看看？”：product_recommendation/completed，返回`[体验] 曲奇饼干`；发送“收货地址怎么添加？请简洁回答。”：general/completed，0张商品卡片。结果`.impeccable/review/t015/intent-extra-real.json`；上述真实证据只能代表已执行的问法，不承诺所有中文表达识别无误。
- 分类复验“介绍一下现在的水果商品”曾空返回，缺陷为精确分类词被当成名称检索；新公开查询回归先RED（`.git/design-references/t015-category-red.log`），规范化后GREEN。未提供分类或同分类时精确分类别名转换为category+空keyword；未知具体名称或冲突分类不放宽。修正首次真实复验又发现模型直接沿用旧空结果，补历史助手消息显式非实时标签与每次产品需求重新查询提示，避免旧拒答作为当前事实。
- 最后用相同真实问法复验：product_introduction/completed，返回`[体验] 柠檬`、`[体验] 牛油果`、`[体验] 青葡萄`三款真实水果；实际模型结果`.impeccable/review/t015/intent-category-real.json`，执行日志`.git/design-references/t015-category-final.log`。最终本地API/Worker镜像已更新，三服务healthy，部署日志`.git/design-references/t015-final-deploy.log`。
- 实际截图：`.impeccable/review/t015/chat-recommend-real.png`、`chat-introduction-real.png`、`product-detail-real.png`、`chat-restored-real.png`。`long-image-failure-fixture.png`、`no-match-fixture.png`、`welcome-fixture.png`仅原生界面夹具，不能据此声称真实模型空结果或图片网络故障通过。
- 独立Impeccable首轮五部分审查判定fix：原生text内嵌view使“查看商品”箭头未显示；改为view容器内文字与箭头同级，重捕真实推荐/介绍及长名失败夹具。复评只检查这项修复，resolved / remaining clear / disposition ship；记录`.impeccable/review/t015/finish-review.md`与`finish-verdict.md`。修复后专项重新23/23；全量重新排队串行执行。重捕真实两图仅将本人已持久目标轮次用于单条展示，之后load恢复原历史，不伪造模型响应。
- 真实回答含体验商品边界、参考价及以下单报价为准；没有订单写工具。新卡片复用已有商品图片，来源继续见`scripts/demo-catalog/manifest.json`，无新增位图资产。
- 独立documenter完成一次有界合并：`DESIGN.md`与`.impeccable/design.json`只增加导购行局部尺寸/动效/组件预览，`PRODUCT.md`补只读能力；原系统保持，报告`.impeccable/review/t015/design-persistence.md`。sidecar JSON有效，咖啡首图摘要与manifest一致，既有人工客服样式漂移未顺带改动；未把本机审查截图当发布资产。

## 最终全量与完成边界

首轮全量`npm test` 338/338、0失败/跳过、exit0（`.git/design-references/t015-final-full.log`，22:49:21–22:53:49）；箭头修复后第二轮338/338、exit0（`.git/design-references/t015-corrected-full.log`，22:54:14–22:58:50）。后续发现分类与旧上下文缺陷，因此上述计数不是最终版本验收。分类修订轮339/339、exit0（`.git/design-references/t015-category-full.log`，23:00:11–23:04:36）启动后提示又更新，因此再按最终专项24/24→全量的顺序验收。

**最终 `npm test`：339/339通过，0失败、0跳过、0取消，exit0。** 完整构建、TypeScript与架构检查均通过；日志`.git/design-references/t015-accepted-full.log`，结果`.git/design-references/t015-accepted-full-result.json`，2026-10-06 23:04:36–23:09:07（上海时间）。不以此前轮次或任务专项替代本次全量。

AC01–AC06本地范围落实；本次仅提交F053实现、必要回归及对应文档，保留既有协调/T005未提交内容，未推送。安卓真机触摸/字体/键盘/系统减少动态效果、真实支付、公网发布均未验；分类/关键词推荐不等于严格预算、口味或全库智能排名，模型自然语言理解不能保证所有表达均正确。
