# 本地微信模拟环境

1. `npm run sim:init`：生成隔离配置和测试密钥（已有文件保持不变）。
2. `npm run sim:up`：构建并启动独立项目；后台 http://127.0.0.1:8380、API 3300、PG 5534、控制面3399。
3. 读取 `.env.simulation`，用 `node --env-file=.env.simulation backend/dist/bootstrap/create-admin.js` 初始化测试管理员（在本地配置 ADMIN_INITIAL_USERNAME/ADMIN_INITIAL_PASSWORD；不把密码放聊天或Git）。
4. `node scripts/simulation/control.mjs '{"action":"login-code","user":"alice"}'` 生成模拟登录code，经正常后端登录接口换取会话。手机号用phone-code。
5. 正常下单后发起支付，控制payment-state为SUCCESS，再notify-payment；回调验签后后端才确认。退款同理先正常业务建退款，控制refund-state，notify-refund。failure控制渠道故障。
6. `npm run sim:status` 查看；`npm run sim:down` 停止，保留数据。

所有用户/资金/渠道事实均为模拟。openid固定sim-alice/bob/charlie，code随机一次性。Control需本地令牌，不开放CORS；禁止把模拟配置用于生产。模拟支付退款持久化在独立卷，身份code重启失效。小程序真实wx.login/requestPayment只能在微信环境执行，本地自动验收由实际页面逻辑+wx装置驱动，不伪装真机。
