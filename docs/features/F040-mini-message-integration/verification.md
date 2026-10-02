# F040 实际验证记录

日期：2026-10-02（Asia/Shanghai）。结论：本地开发验收通过；微信开发者工具/真机未验。

## 测试策略（非 TDD，页面展示类）

后端契约由 F037–F039 TDD 与集成测试覆盖；页面实现后以构建 + 有数据隔离环境浏览器交互验证。

## 集成测试（真实 PG+HTTP+生产装配）

`t009/integration-db-http.test.mjs` 8/8 通过（先红：控制器分页占位符缺陷致 500，修复后绿）：

1. 看板总览/商品逐指标（含 O1 全额退款后仍计今日支付但剔除服务费口径）+ 历史日参数 + 空日。
2. 客服数据与阈值环境变量（CS_FIRST_RESPONSE_TIMEOUT_MINUTES=1）。
3. 权限矩阵：cs_supervisor 仅客服数据 200；catalog_admin/cs_agent 403；未认证 401；客服资金审核 403 边界不变。
4. 事件补抓 3 条幂等；消息中心本人可见、未读数、已读幂等保留首次、他人 404、未登录 401。
5. 投递 skipped 留痕；仅 failed 可手工重试（skipped 409 DELIVERY_NOT_RETRYABLE）；审计落库且归到操作管理员。
6. 超时提醒恰一条×在线主管、二次幂等。
7. 审计查询筛选/脱敏/角色矩阵/时间范围。

## 页面交互（隔离有数据环境浏览器实操）

- 登录 → /reporting 三区块指标与种子一致；/access 日志+矩阵+详情脱敏；/notifications 三条投递（1 failed 可重试、2 skipped 禁用重试）。
- failed 行「重试」→ confirm 确认 → 成功提示「已重置为待投递」→ 列表刷新为待投递（DB 与界面一致）。
- cs_agent 登录：看板显示「当前角色没有看板查看权限」；审计页显示 403「没有该操作权限」。
- 空态：客服接待量「暂无已接入会话」；集成测试覆盖审计/投递空筛选与空基准日。

## 构建

- 管理端 `npm run build -w @pindian/admin-web`（vue-tsc + vite）通过。
- 小程序 `npm run typecheck -w @pindian/mini-program` 通过；页面四件套 + app.json 注册 + profile 入口（未读徽标）完成。

## 未验证

- 微信开发者工具编译/预览与真机（无用户环境）：消息中心页仅通过 TypeScript 检查与接口集成验证。
- 真实用户消息触达（依赖外发渠道，D021）。
