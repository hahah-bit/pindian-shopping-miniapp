# 会话消息与补取 规格

依据：[整体 spec](../../tasks/T008-customer-service-after-sales/spec.md)，[整改 spec](../../tasks/T008-customer-service-after-sales/remediation.md)。

范围：RC01–RC04。用户本人校验与客服分配校验必须在后端成立；非授权资源 404，字段校验 400，状态或幂等冲突 409。失败不留下半条业务事实；金额整数分，时间 ISO-8601，页面包括加载、空态、失败、权限和正常状态。

契约、场景和 Given/When/Then 继承上述 spec。退款/补发规则引用已确认D020及F036，不由本功能另行修改。当前不包含语音、视频、文件、AI。

同键内容比较遵循 JSON 字段值，忽略对象字段顺序；PostgreSQL jsonb 改变字段排列不能导致同一张卡片重试冲突。金额不参与客户端重算，卡片授权仍重新复核。
