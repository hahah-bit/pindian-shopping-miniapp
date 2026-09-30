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

## 集成补验（已完成）

真实 PG 集成（t004/integration）：建组预留 available 3→2 / reserved 0→1 断言通过；组2 建组第二件预留通过；并发最后份额恰一人加入、败者库存 0 建组失败 STOCK_INSUFFICIENT——库存不超卖实证（G5）。组成功/截止触发的消耗与释放由内部支付用例单测与截止任务覆盖。

## 原未覆盖项（已被集成补验取代）

（已被上方集成补验覆盖）
