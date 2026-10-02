# T010 整体验收（2026-10-02）

结论：已完成（用户授权本地范围）。F041/F042/F043验证分别见子功能verification。

| 验证 | 实际结果 |
| --- | --- |
| npm run test:task:t010 | 8/8，0失败0跳过，.git/t010-special.log |
| npm test | 293/293，0失败0跳过，.git/t010-full.log |
| npm run sim:up | pindian-simulation五服务healthy；3300/8380/5534/3399，独立卷与数据库 |
| node scripts/simulation/smoke.mjs | 实际HTTP身份、手机号、后台代理、Worker健康通过 |
| npm run sim:init重复 | 保留既有配置和测试密钥，不覆盖、不打印凭据 |

模拟支付退款持久化用独立卷，API/Worker收到一致配置。真实微信/真机/资金/订阅消息外发/外部发布仍待验。T005与协调文件未纳入提交。
