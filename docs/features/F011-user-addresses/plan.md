# F011 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T003 plan](../../tasks/T003-user-identity-address/plan.md) S3。

## 测试策略

采用 TDD：归属、默认唯一并发、上限、校验是核心约束（AGENTS 2.2.1）。测试文件 `tests/task-suites/t003/address.test.mjs`（内存仓储先红后绿）；行锁/部分唯一索引/并发设默认在 t003 集成测试用真实 PG 验证。页面非 TDD，冒烟验证。

## 步骤

- [ ] P1 迁移 0008（user_addresses：字段 CHECK、默认部分唯一索引、user_id 索引）。
- [ ] P2 contracts：AddressView/AddressSaveRequest + OpenAPI。
- [ ] P3 TDD 领域：Address 工厂与校验矩阵、迁移方法。测试先行。
- [ ] P4 TDD 应用：ListMyAddresses/CreateAddress（上限）/UpdateAddress/DeleteAddress/SetDefaultAddress（行锁编排）；内存仓储先红后绿。
- [ ] P5 适配器：pg AddressRepository（userId 作用域、FOR UPDATE、部分唯一冲突兜底）。
- [ ] P6 入口：MiniAddressesController（user realm，全方法）。
- [ ] P7 小程序：地址列表页（features/address/pages/list）+ 表单页（features/address/pages/form，region picker、校验、删除确认）；profile 页入口；app.json 注册。
- [ ] P8 验证：单测证据 → 集成（归属/并发默认/上限/重启保留）→ 页面冒烟；回写 verification.md。

## 完成标准

spec AC-F11-1..6 满足；地址数据不向后台普通接口泄露；T003 plan S3 勾选。
