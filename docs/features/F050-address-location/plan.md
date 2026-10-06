# 地址原生选点实施

依赖 [DDD](ddd.md)、[spec](spec.md)，覆盖 AC04。

采用 TDD：成功填充、取消不覆盖、拒绝反馈、地区重新确认、手动编辑后保存。官方能力真实验证另记。

1. 定义公开契约、输入限制、错误码与失败状态。
2. 按 apps/mini-program/miniprogram/features/address、app.json 实施端口/适配器/页面，保持领域依赖方向。
3. 存储与环境：调用 wx.chooseLocation，需微信位置/隐私权限；不使用第三方地理编码，暂不需要地图 Key。不猜测行政区划，选择后清空待确认省市区，保留手填。
4. 执行 tests/task-suites/t013 对应功能测试及真实接口冒烟；整体专项通过后 npm test。
5. 记录实际结果和未验项，精确暂存并中文 feature 提交，继续下一功能。
