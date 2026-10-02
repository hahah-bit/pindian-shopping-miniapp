# F039 实际验证记录

日期：2026-10-02（Asia/Shanghai）。结论：本地开发验收通过。

## TDD 红绿记录

- 先红：`audit-query.test.mjs` 实现前 `MODULE_NOT_FOUND`。
- 修正两处测试自身口径错误后绿：resourceType='ticket' 种子实为 2 条；手机号掩码断言与种子行的对应关系（138 在 ticket 行、139 在 phone_reveal 行）。
- 后绿：7/7 通过。

## 覆盖

| 场景 | 结果 |
| --- | --- |
| 分页 | 13 条日志：total、每页条数、created_at DESC 稳定排序、页间不重复 |
| 筛选 | 动作前缀（fulfillment.ship→6）、资源类型（ticket→2）、管理员（审计乙→4）；LIKE 通配符转义（'%' 字面量→0） |
| 时间范围 | 上海日界：昨日 23:59 归昨日、今日 00:01 不归昨日；from=to=昨日→2；跨两日→12 |
| 脱敏 | phone 键值与正文中裸手机号两路掩码（138****1230 / 139****7777）；响应无完整号码；库内原文未变（响应层脱敏） |
| 非法日期 | 400 VALIDATION_FAILED |
| 权限矩阵 | 4 角色；super_admin 含 4 新码；cs_supervisor 含 reporting:view_cs 不含 reporting:view/audit:view；cs_agent 仅 agent:manage；标签中文 |
| 端到端 | 集成：notification.retry 审计可按动作筛选出且管理员名正确；脱敏在 HTTP 响应验证；cs_agent 403；admin.login 等既有写入在浏览器审计页可见 |
| 回归 | T002 super_admin 权限列表断言按 D025 扩展（8→12 码，只增不改）；全量 280/280 含 T002/T003/T008 既有权限断言通过 |
| 浏览器 | 隔离有数据环境：/access 日志表+筛选+分页+矩阵渲染；详情展开显示 138****1230 且无完整号码（DOM 断言） |

## 未验证

日志归档/分区（数据量大时的存储策略，非本轮范围）。
