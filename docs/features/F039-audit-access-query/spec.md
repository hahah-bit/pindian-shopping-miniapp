# F039 Spec

引用 [T009 spec](../../tasks/T009-dashboard-notification-audit/spec.md) §3.3/§3.4、验收 A3/A7/A9；补充细节：

- 筛选语义：`action`/`resourceType` 前缀匹配（LIKE，转义 `%_`）；`adminId` 精确；`from`/`to` 为 Asia/Shanghai 日界转 timestamptz 范围（含 to 当日全天）；排序 `created_at DESC, id DESC` 稳定分页。
- 脱敏：detail 递归（对象/数组）；键名 `phone|telephone|mobile` 或字符串值匹配 `1[3-9]\d{9}` → 前3+`****`+后4；库内原文不改。
- 角色矩阵：ROLE_PERMISSIONS 静态映射 + 中文角色标签；需 `audit:view`。
- 权限码扩展后：super_admin 全量；cs_supervisor 增 `reporting:view_cs`；cs_agent/catalog_admin 不新增。
- 回归红线：T002/T008 既有权限断言不放宽，只增不改。

## 验收条件
- A7.1 种子日志跨管理员/动作/资源/日期：分页 total 与页内容正确、排序稳定。
- A7.2 各筛选组合命中正确；时间范围含日界数据归日正确。
- A7.3 含手机号 detail 响应脱敏（键与裸模式两路），库内原文未变。
- A7.4 cs_agent 403；未认证 401。
- A9 既有全量套件零跳过通过。
