# F013 实际验收记录

日期：2026-09-30。结论：本功能（纯领域函数）验收通过。

## 测试证据

| 验证 | 操作 | 结果 |
| --- | --- | --- |
| TDD 红灯 | 实现前运行 completeness.test.mjs | Cannot find module（模块缺失） |
| TDD 绿灯 | 实现后 | 5/5 通过 |
| 对拍 | 15 种允许集合非空子集 × 0..60 全表 vs 有界穷举 | 完全一致（G1） |
| 边界 | 组满、单位不在集合、超容、加入后不可完成 | 全部拒绝（G2） |
| 采样修正 | 初版采样断言 {20,15} 剩 55=false 有误（55=20+20+15 可行），以穷举对拍为准修正为 true | 实现正确，测试修正 |

## 覆盖

- buildCompletenessTable：整型 DP（dp[0]=true，O(60×|S|)），非法输入拒绝。
- canJoinGroup：remaining>0、单位 ∈ 快照集合、≤剩余、dp[remaining−units]。
- remainingCapacity：60−paid−reserved，超容抛错。
- 无浮点、无贪心；匹配排序（remaining↑, createdAt↑, id↑）由 F015/F018 的仓储查询与集成测试验证。
