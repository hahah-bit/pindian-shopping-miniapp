# T014 验收记录（2026-10-06）

范围：客服原生Tab、精灵/文字对话、地址和订单列表动作层级。本轮不改变后端业务或模型配置。**本地范围完成**：最终专项13/13后全量328/328，独立视觉审查ship，失败/跳过均0。

## 页面生命周期的红绿证据

先执行 `node --test tests/task-suites/t014/support-page.test.mjs`：初始5项均因目标行为缺失失败（第三Tab仍是我的、缺少onShow/onHide、迟到历史覆盖新身份、旧请求阻碍新用户发送）。日志 `.git/design-references/t014-red.log`。

实现后5/5；随后补充同身份请求版本、分页隔离与失败消息恢复验证，实际页面装置7/7。装置加载实际TypeScript页面/API客户端，只替换wx平台HTTP响应；不将其写为真实微信/渲染验收。

`npm run test:task:t014` 最终专项13/13，失败0、跳过0：新增7项加既有F051 HTTP/PG/Pi6项；构建、原生TypeScript及架构检查通过。任务注册显式选择t014和两份F051测试；全量不会重复导入。日志 `.git/design-references/t014-task-final.log`。Pi集成场景使用受控模型HTTP端点，非本轮DeepSeek真实调用。

## 原生交互与截图

微信开发者工具 iPhone12/13Pro，逻辑宽390、SDK3.17.3，使用官方miniprogram-automator，未使用网页效果图代替。截图含本人敏感资料，仅保留在忽略目录 `.impeccable/review/t014/`。

- 实际本人数据：1条订单已失效、1条地址、1轮现有完成AI消息；实际本地API返回并渲染。现有回复来自T013已经完成的官方DeepSeek联调，本轮未重复调用模型。
- 空态、思考、失败、多行、未登录、静止、待支付取消按钮：临时page.setData的UI夹具，仅改页面内存、不写数据库；示例发送消息明确标记“界面状态示例”。检查完恢复真实历史/草稿及键盘高度。
- 地址动作实际命中框：默认72×49、编辑49×49、删除49×49逻辑px；取消79×49，满足该390宽环境96rpx要求。输入多行框297×68。没有点击真实删除/取消或新增订单。
- 实际点击右上人工与售后，确认路由 `features/cs/pages/index/index`、加载完成；中心的AI入口switchTab回客服成功。个人页旧入口直接进入客服Tab。
- onHide/关闭动效状态有页面测试证据；原生静止状态和pending已截屏。CSS仅transform/opacity等局部循环，无JS循环/计时器；静态截图不能证明安卓实际眨眼节律、帧率或系统减少动效支持。
- 键盘260px事件注入验证布局可收缩且多行可见；不是实际系统键盘验收。补充脚本尝试读取非顶部缓存页面data遭自动化装置拒绝，未计为成功；已独立恢复真实客服页，缓存生命周期依据实际页面单测。
- 首次人工截图因导航尚未完成，独立审查要求recapture；仅补该图，实际点击及路由确认后截图，不修改产品逻辑。

## 全量回归

专项通过后执行 `npm test`，包含typecheck、全项目build、架构检查及全部tests：**328/328，失败0、跳过0、取消0，exitCode=0**。运行22:18:29–22:22:55，测试阶段235801.5ms。后台隐藏PowerShell仅承载长命令，日志 `.git/design-references/t014-full.log` 与结果JSON保存起止及退出码。包含本地交易、客服、Worker、HTTPS部署/备份恢复演练；不将受控渠道写为真实支付。

独立审查先要求补真实人工入口截图，再要求同步设计文档；documenter发现减少动效媒体分支优先级不足，被reviewer纳入唯一代码修正。实现前补充F052 DDD/spec/plan，只将`.moving.thinking .body`加入媒体选择器，与正常ponder同特异性且后声明覆盖。保留此前原生布局证据，不另改布局。

修复后重新执行 `npm run test:task:t014`：13/13，失败/跳过0，日志 `.git/design-references/t014-task-reduced.log`；随后新的 `npm test` **328/328，失败/跳过/取消0，exitCode=0**，22:25:32–22:29:43，测试阶段231252.7ms。日志 `.git/design-references/t014-final-full.log` 与结果JSON。系统偏好与原生scroll动画的映射未验，不将CSS分支源优先级复核当作实机验收。

## 独立视觉与设计记录

按用户指定Impeccable 4.5.0进行普通扩展；最终独立finish-review **disposition: ship，remaining: clear**。报告五部分及documenter记录在忽略的 `.impeccable/review/t014/`，先recapture真实人工中心，再完成四Tab/控件/精灵/多行输入文档与减少动效选择器修正，未扩大配色或业务范围。DESIGN.md及sidecar只合并本次实装；JSON及差异检查通过。新栅格出处与SHA见[F052验证](../../features/F052-support-companion/verification.md)。

安卓真机、真实IME/字体放大/安全区、实际触摸手势与动效帧率仍待验；不声称上线或整机验收完成。
