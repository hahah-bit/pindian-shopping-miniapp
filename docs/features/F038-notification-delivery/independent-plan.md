# F038 独立整改实施

依据[DDD](ddd.md)、[补充spec](independent-spec.md)。负责Codex，范围通知应用、PG适配器、装配、0028迁移、t009回归。

采用TDD：先真实PG故障注入/双实例认领/扫描分页/审计失败回归，再改实现。核心事务与幂等风险不能仅Fake验证。

1. [ ] R01–R04回归先红，保留.git日志。
2. [ ] 通知插入事务，lease令牌条件认领/保存，主管缺通知过滤，重试与审计共事务。
3. [ ] t009专项→npm test→隔离Compose冒烟→浏览器，写independent-verification。
4. [ ] 中文fix提交；T009原验证保留，补充最新结论。
