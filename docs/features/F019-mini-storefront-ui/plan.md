# F019 plan（未实施）

上游：[DDD](ddd.md)、[spec](spec.md)、[T005 plan](../../tasks/T005-mini-ui-redesign/plan.md)。覆盖整体 AC01–AC08、AC10–AC11；采用 T005 的“专项先通过，再执行项目全量”安排。2026-10-01用户再次明确仅规划，代码实施待后续指令。

## 实施顺序与位置

1. 核验 GitHub 固定提交、素材与许可、TDesign组件版本；依据仓库 npm workspace 与开发者工具实际行为确定 npm 构建引用。修改范围预期为小程序 package/config 与根 lockfile，不直接继承模板全部依赖和脚本。
2. 在 `apps/mini-program/miniprogram/styles/storefront/` 定义主题，`components/storefront/` 放纯展示的错误/空/加载组件，本地资源放小程序 `assets/storefront/`；统一 `app.wxss` 并排查 button 等全局选择器影响。
3. 在参考预览中先验证双列瀑布流与混合图比例，再修改 `features/catalog/pages/index/`、`detail/` 的视图/样式和必要视图适配；图片框按比例及准备时限分配、较短列追加、固定已显示位置；复用原金额格式化、图片错误、分页、导航、下单与API，即时验证AC02–AC04、AC10–AC11。
4. 修改 `features/profile/`、`features/address/`；校验表单组件事件能传入原有方法，地区 picker 和微信授权绑定正确，执行 AC05–AC06 冒烟。
5. 修改 `features/orders/`真实列表/详情展示、为原三项 `app.json` tabBar配置本地图标；保留现有交易动作和支付未开放提示，统一安全区与页间视觉，执行AC01/AC07。
6. 依照 T005 P7/P8 完成开发者工具 npm 构建、逐页专项、真实联调与全量；创建本功能 verification 保存实际结果，不能先标完成。

## 测试与兼容策略

不采用 TDD：当前仅界面与框架装配，无领域行为变化；出现行为缺陷则先回归测试。冒烟涵盖真实商品分页/详情/份额价格、图片错误、空和失败、登录权限、手机号原生事件、地址校验和提交状态、导航安全区。命令与环境完整复用 T005 plan §3。

无数据迁移、新接口、新幂等策略或后端权限变更。保留原始AppID及用户本地配置，实施时只改必要的组件构建项，不覆盖用户配置。固定依赖升级和页面事件变化需要记录并回归；旧页面可逐页迁移，但最终七页面统一后才进入整体验收。

当前完成：DDD/spec/plan。待完成：以上全部代码、构建、预览、联调和验证步骤。
