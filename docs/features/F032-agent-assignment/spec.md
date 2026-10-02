# 客服在线与分配 规格

依据：[整体 spec](../../tasks/T008-customer-service-after-sales/spec.md)，[整改 spec](../../tasks/T008-customer-service-after-sales/remediation.md)。

范围：RC08。用户本人校验与客服分配校验必须在后端成立；非授权资源 404，字段校验 400，状态或幂等冲突 409。失败不留下半条业务事实；金额整数分，时间 ISO-8601，页面包括加载、空态、失败、权限和正常状态。

契约、场景和 Given/When/Then 继承上述 spec。退款/补发规则引用已确认D020及F036，不由本功能另行修改。当前不包含语音、视频、文件、AI。

客服账号由超级管理员创建和启停：`GET/POST /api/admin/v1/cs/accounts`、`POST /accounts/:id/status`，权限 admin:manage；角色仅 cs_agent/cs_supervisor，不能借该接口创建超级管理员或改其他角色。用户名 3–32 位小写字符，密码 10–128 位，只返回账号摘要，不返回哈希/密码。账号保存和审计同事务；停用撤销旧会话，重新启用必须重新登录。
