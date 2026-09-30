# F013 份额可完成性与组匹配 DDD

复用 [T004 ddd](../../tasks/T004-group-order-reservation/ddd.md) §4.1/4.2。纯领域函数，无 IO。

## Completeness（可完成性）

- `buildCompletenessTable(allowedUnits)`：返回 boolean[61]，dp[0]=true，dp[s]=∃u∈allowed 且 dp[s−u]。整型运算，O(60×4)。
- `canJoinGroup(table, remaining, myUnits)`：remaining>0 ∧ myUnits ∈ allowed ∧ myUnits ≤ remaining ∧ dp[remaining−myUnits]。
- 组的 allowedUnits 恒取**组快照**（D003）。

## GroupMatching（候选与排序）

- 候选条件：open ∧ deadline>now ∧ productId 相同 ∧ remaining ≥ myUnits ∧ canJoin。
- 排序：remaining 升序 → createdAt 升序 → groupId 升序（完全稳定）。
- 候选仅供选择；写入事务内行锁重查（容量、deadline、status、可完成性）。

## 不变量

- 剩余容量 remaining = 60 − paidUnits − reservedUnits（仅 open 组有意义）。
- 拒绝：remaining==0、myUnits ∉ allowed、myUnits > remaining、dp[remaining−myUnits]=false。
