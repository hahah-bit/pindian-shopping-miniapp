# T014 客服导航与精灵对话体验

- 目标：解决用户截图中的操作按钮过重，并将客服移入原生Tab，直接对话，增加精灵表情与文字交流状态。
- 主领域：CustomerService展示；协作领域：Ordering/IdentityAccess展示；负责Agent：Codex。
- 修改范围：apps/mini-program、scripts/ui、测试及相应设计文档；不改后端交易、AI权限或接口。
- 依赖：T013；状态：已完成（本地范围）；阻塞：无本地开发阻塞，安卓真机独立待验。
- 子功能：F019按钮层级修订、F051原生Tab生命周期修订、[F052精灵聊天](../../features/F052-support-companion/README.md)。
- [DDD](ddd.md) · [spec](spec.md) · [plan](plan.md)。授权：2026-10-06用户本轮截图与直接修改请求，按文字交互视觉实施，无语音录制。
