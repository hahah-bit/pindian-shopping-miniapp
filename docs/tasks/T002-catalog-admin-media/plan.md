# T002 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。先 spec 后本计划；实现按依赖顺序推进，每步完成后更新勾选。

## 测试策略（按第 2.2 节判断）

| 子功能 | 策略 | 理由与验证范围 |
| --- | --- | --- |
| F005 身份权限 | TDD | 会话生命周期、token 哈希、限流、权限守卫是可自动验证的安全规则；先写失败测试再实现 |
| F006 图片管理 | TDD | 校验规则（魔数/尺寸/大小）、补偿逻辑、引用约束可自动验证 |
| F007 商品库存 | TDD | 上架条件、状态迁移、金额/数量计算、库存非负与幂等是核心业务规则 |
| F008 小程序展示 | 非 TDD | 页面布局与展示为主；以类型检查 + 契约测试 + 真实接口联调冒烟验证 |
| 管理后台页面 | 非 TDD | 布局与表单为主；以真实后端联调冒烟 + 浏览器实操验证 |

TDD 执行方式：测试先于实现写入 `tests/task-suites/t002/`，运行确认因目标行为缺失而失败（模块不存在/断言失败），再实现使其通过；保留失败与通过证据于 verification.md。

- 专项测试 `npm run test:task:t002`：领域与应用规则测试（纯内存）+ 契约测试 + 需要 PostgreSQL 的集成测试（数据库不可达时集成部分明确 skip 并说明，不得视为通过）+ Docker 冒烟另行执行。
- 全量测试 `npm test`：所有 workspace 类型检查/构建 + 架构检查 + tests 下全部套件（含 T001 回归）。
- 联调验证：`npm run docker:up` 后执行管理员实操（浏览器）与小程序接口验证；容器重建后图片可读。

## 步骤

- [ ] S1 契约与类型：扩展 `contracts/src/index.ts`（auth/media/product/stock/mini DTO、错误码、分页）与 `contracts/openapi.yaml`；T001 元数据断言随真实契约演进调整（catalog/identity-access/inventory/audit → `partial`）。覆盖 AC12 前置。
- [ ] S2 基础设施：迁移执行器 `bootstrap/migrate.ts`、`create-admin.ts`、共享内核（ApplicationError/TransactionRunner/Clock）、config 扩展、multer/image-size 依赖、compose media 卷与启动命令、Dockerfile 调整、`.env.example` 与 init-env 合并逻辑、npm scripts。覆盖 AC09 前置。
- [ ] S3 F005 实现（TDD）：迁移 0001/0002；domain（Admin/AdminSession/权限码）→ 测试 → 应用用例（登录/登出/认证/初始管理员）→ pg 适配器 → 守卫与 auth 控制器 → 后台登录页与路由守卫。覆盖 AC01/02。
- [ ] S4 F006 实现（TDD）：迁移 0003；domain MediaAsset + 校验 → 测试 → UploadMediaAsset/ListMediaAssets/DeleteMediaAsset + ImageStorage 本地适配器 + 公开读取控制器 + URL 生成 → 后台上传组件与图片库。覆盖 AC03/04。
- [ ] S5 F007 实现（TDD）：迁移 0004/0005；domain Product/ShareOption/ReferencePricing/Stock → 测试 → 用例与工作流（创建事务/编辑/发布条件/库存调整）→ pg 适配器（行锁/CHECK/幂等索引）→ admin 控制器 → 管理后台商品列表/表单/库存 UI。覆盖 AC05/06/07/10。
- [ ] S6 F008 实现：mini 公开接口复用 catalog 用例；小程序列表页/详情页/http 封装/mock 标注；注册页面；类型检查与页面配置测试。覆盖 AC08。
- [ ] S7 集成测试补全：tests/task-suites/t002/integration-db-http.test.mjs（真实 PG + 真实 HTTP 全流程：登录→上传→建品→上架→mini 读取→库存并发/幂等→下架 404→删除引用拒绝）。覆盖 G1–G12 可自动化部分。
- [ ] S8 联调与运维验证：`npm run docker:up` 重建（含迁移自动执行）；浏览器实操后台全流程；mini 接口真实数据验证；容器重建后图片可读；备份/恢复命令演练（数据库 + 图片卷）。覆盖 AC09/10/11。
- [ ] S9 专项 → 全量：`npm run test:task:t002` 通过后 `npm test`、`npm run smoke:docker`；失败则修复并对受影响专项重验再全量。覆盖 AC11。
- [ ] S10 回写：各 verification.md、README（阶段与操作说明）、architecture.md（媒体存储决策与状态）、AGENTS 状态段、平台元数据文案；交付清单与待决策项汇总。

## 完成标准

spec AC01–AC12 全部满足并在 [verification.md](verification.md) 有实际执行证据；未验证环境（微信开发者工具/真机）如实记录。
