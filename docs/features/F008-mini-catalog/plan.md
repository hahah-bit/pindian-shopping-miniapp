# F008 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T002 plan](../../tasks/T002-catalog-admin-media/plan.md) S6。

## 测试策略

不采用 TDD：页面布局与展示为主，不改关键业务行为（AGENTS 2.2.2）。验证方式：TypeScript 类型检查 + 页面注册契约测试（tests 下 mini 配置测试自动覆盖新页面）+ 真实接口联调（列表/详情/空/失败路径，随 T002 S8 联调执行）+ 金额格式化纯函数单测（`tests/task-suites/t002/mini-format.test.mjs`，字符串运算防浮点回归）。开发者工具/真机验证依赖用户环境，未执行则如实记录。

## 步骤

- [ ] P1 `platform/http.ts` 请求封装与错误对象；`utils/format.ts`（formatFen 字符串运算）+ 单测先行（先失败后实现）。
- [ ] P2 `platform/api-catalog.ts`：getProducts/getProductDetail（契约类型）；mock 数据模块（同构 + 标注）；`config.ts` 默认切 api。
- [ ] P3 列表页改造：状态机、卡片、下拉刷新、触底分页、空/失败/重试、mock 标注条。
- [ ] P4 详情页新建：轮播、信息区、份额卡片、库存徽标、404 提示、底部说明；`app.json` 注册。
- [ ] P5 联调（随 T002 S8）：真实 API 渲染、图片可访问、下架 404、失败态（停 API）、空态。
- [ ] P6 回写 verification.md（含未验证环境声明）。

## 完成标准

spec AC-F08-1..8 中不依赖微信 IDE/真机的项全部满足；AC-F08-8 如实记录。
