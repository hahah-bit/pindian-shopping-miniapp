# F021 plan

TDD：`tests/task-suites/t006/payment-confirm.test.mjs`（假件先红后绿）。回调解密/验签在渠道适配器（F020 端口），工作流只处理已解密事实。

- P1 ConfirmPaymentWorkflow + RefundCreationPort 声明。
- P2 测试矩阵：正常/组满/重复/金额不符/迟到/组成功后迟到/预占过期兜底。
- P3 验证 + 提交。
