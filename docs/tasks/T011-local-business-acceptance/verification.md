# T011 整体验收
先专项npm run test:task:t011：4/4；后npm test：298/298（含此时新增F046守卫1项），均0失败0跳过。随后模拟Compose重建五服务健康、身份冒烟和整体业务冒烟通过，后台浏览器登录/订单/履约部分发货/看板交互通过。
详见[F044](../../features/F044-mini-page-harness/verification.md)、[F045](../../features/F045-business-e2e/verification.md)。页面逻辑请求真实API，wx为模拟；微信开发者工具渲染、真机、真实资金、体验版待验，不冒充通过。

开发者工具可用性实际检查：本机安装微信开发者工具2.02.2608080，CLI islogin返回“服务端口已关闭”，当前无法CLI编译/页面检查（.git/wechat-devtools-check.log）。本轮保留未验，不更改工具安全设置，不上传体验版。
