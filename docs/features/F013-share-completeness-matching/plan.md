# F013 plan

依据：[spec](spec.md)、[DDD](ddd.md)。

## 测试策略

TDD：`tests/task-suites/t004/completeness.test.mjs`。先写 DP 与穷举对拍（red：模块不存在）→ 实现转绿。匹配排序属仓储职责（SQL ORDER BY），排序规则的单元验证放在 F015/F018 集成；本子功能交付纯函数。

## 步骤

- [ ] P1 实现域 `group-buying/domain/completeness.ts`（buildCompletenessTable/canJoinGroup）。
- [ ] P2 测试通过后提交 Git（含本文档与验证记录）。

## 完成标准

对拍测试与边界测试全绿；无浮点/无贪心；提交哈希记录于 T004 verification。
