# F036-reviewed-after-sales 实际验证

AP01–AP08：成功组原实付全额退款、两个超级管理员并发只执行一次、普通客服审核403、履约摘要归属404；completed补发正常进度不变；action/审计故障完全回滚；历史零分配逐单审核；首次生成前退款停止；浏览器真实待审核申请与异常链接。

统一实际命令与结果见 [任务最终验证](../../tasks/T008-customer-service-after-sales/remediation-verification.md)。本feature包含于T008专项36/36及项目全量249/249，零跳过；不能将整套数量冒充本feature单独测试数量。审批TDD初始5例先失败见本机t008-approval-red.log，后通过见approval-green.log；其他TDD红灯记录与后续通过见任务记录。
