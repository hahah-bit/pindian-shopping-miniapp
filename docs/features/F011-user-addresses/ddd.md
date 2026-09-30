# F011 DDD

复用 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.4（Address 不变量）、§7.2（设默认时序）。补充细节，无超出大任务的领域变更。

## 模型细节

- `Address.create({userId, receiverName, phone, province, city, district, detail, isDefault=false})`；字段校验见 DDD §2.4（姓名 1–20、手机号 `^1[3-9]\d{9}$`、省市区各 1–20 非空、详情 5–120）。
- `Address.rename/relocate/setDefault/unsetDefault` 返回新实例；删除在仓储层（按 id+userId 条件删除，返回是否删除）。
- 设默认用例（行锁事务）：SELECT 目标 FOR UPDATE + 归属校验 → UPDATE 同用户 `is_default=false WHERE user_id=$1 AND id<>$2` → UPDATE 目标 `is_default=true`；部分唯一索引 `UNIQUE(user_id) WHERE is_default` 兜底并发。
- 删除默认地址：直接删，无默认态合法（spec 决策）；不自动补。
- 上限 20：创建前 `COUNT(*) WHERE user_id` ≥20 → 409。

## 端口

`AddressRepository`：`insert/findById(addressId, userId)/listByUser(userId)/update/delete(addressId, userId)/countByUser/clearDefaultExcept(userId, keepId)/setDefault(addressId, userId, session)`。所有方法强制 userId 作用域——跨用户查询返回空，即 404。

## 事务边界

设默认为事务（行锁 + 两步更新）；新增/编辑/删除单行操作；上限检查与插入同事务（计数在行锁内防止并发超限——`SELECT COUNT` 在 FOR UPDATE 锁内读取用户全部地址行？简化：计数竞态窗口影响为 21 条以内数据，不构成约束破坏（非安全边界），接受并记录；上限用事务内计数 + 保守提示，精确并发限制属过度设计）。

## 不做的建模

不做地址软删（快照原则由交易阶段实现）；不做微信地址导入（wx.chooseAddress 仅辅助填表，本阶段不加，避免额外授权面）；不做多收货人。
