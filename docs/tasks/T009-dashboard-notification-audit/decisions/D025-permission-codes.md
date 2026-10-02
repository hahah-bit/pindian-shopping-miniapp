# D025 新权限码与授权矩阵

- **状态**：设计结论（2026-10-02）。需求 §6.1 的角色为建议（含订单管理员、财务人员，系统未引入），用户指令仅要求「完善后台角色权限检查……普通客服不能审核资金操作」。
- **决策**：新增 4 个权限码——`reporting:view`（总览+商品数据，仅 super_admin）、`reporting:view_cs`（客服数据，super_admin+cs_supervisor）、`audit:view`（操作日志查询+角色矩阵，仅 super_admin）、`notification:manage`（投递查询+手工重试，仅 super_admin）。不新增角色。
- **理由**：最小权限默认；cs_supervisor 依需求 §6.1「客服主管：……客服数据」获得客服数据只读权限；资金审核边界（F036：cs_agent/cs_supervisor 只能申请、super_admin 审核）不变，且既有 T002/T008 权限断言保持通过。
