# F014 实际验收记录

日期：2026-09-30。结论：单元层验收通过（4/4，先红后绿）；真实 PG 并发验证随 F015 集成测试执行。

## 测试证据

| 验证 | 操作 | 结果 |
| --- | --- | --- |
| TDD 红灯 | 实现前运行 stock-reservation.test.mjs | Cannot find module |
| TDD 绿灯 | 实现后 | 4/4：预留 available>0 成功且 available=0 拒绝（STOCK_INSUFFICIENT 前置检查 + 条件更新双保险）、释放/消耗业务键幂等（重放不重复变更）、非法输入（非 UUID/空键/短键/坏十六进制）拒绝、库存行缺失拒绝 |
| 防重设计 | business_key varchar(64) + UNIQUE(product_id, business_key)（迁移 0009）；pg adjust 唯一冲突转 replay | 迁移已交付；DB 层验证随集成 |

## 修复记录

- 初版把业务键塞 request_id uuid 列——类型不符。新增迁移 0009 business_key 列与唯一索引；StockAdjustCommand 扩展 businessKey/reservedDelta/allowNegativeAvailable；pg adjust 同步支持（幂等查询按列名分派）。

## 未覆盖（随集成补验）

真实 PG 并发建组不超卖（G5）、组状态触发的释放/消耗全链路——由 F015/F016 集成测试覆盖后回写本记录。
