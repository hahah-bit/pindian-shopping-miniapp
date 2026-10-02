# 登录与手机号模拟 spec

依据：[大任务规范](../../tasks/T010-local-wechat-simulation/spec.md)；用户授权本地/模拟范围。

复用 /sns/jscode2session、/cgi-bin/stable_token、/wxa/business/getuserphonenumber 的既有装置契约；固定 alice/bob/charlie 测试身份，模拟凭证与真实凭证隔离。既有 /api/mini/v1/auth/login 和 /auth/phone 不变。拒绝/失效/故障不得创建或修改身份事实。

验收：TDD：成功登录、凭证重放/失效、手机号拒绝及渠道失败；生产 HTTP 适配器对本地服务联调。 失败保持明确错误与未完成；既有公共 API、权限与金额单位不变。待决策：无本地实现阻塞；真实环境单列待验。

装置契约：POST /simulation/control，Bearer SIMULATION_CONTROL_TOKEN；JSON {action:'login-code'|'phone-code',user:'alice'|'bob'|'charlie',scenario?:'success'|'invalid'|'down'|'expired'|'refused'} → {code}。code随机、一次消费、5分钟本地有效期，openid仅在装置固定sim-{user}。错误控制参数400，未授权401；控制面不开放CORS。GET /health → {mode:'simulation'}。微信接口复用现有适配器协议；手机号info包含既有watermark，拒绝/无效返回渠道错误，不产生业务事实。
