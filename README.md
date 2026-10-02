# 拼单购物平台

原生微信小程序 + Vue 3 管理后台 + NestJS/TypeScript 模块化后端，采用 DDD 和六边形架构。

当前已具备商品、身份与地址、拼单报价、支付退款适配、分份履约、客服工单、审核退款补发、站内通知、看板与权限审计。本轮按T009独立验收→T010本地微信模拟→T011两端/完整业务验收→T012部署恢复准备连续实施。微信使用明确隔离的本地模拟；真实微信/真实资金、开发者工具渲染与真机、体验版上传、正式部署仍待环境验收。T005视觉重设计不在本轮。

## 文档入口

- [Agent 规则](AGENTS.md)
- [整体架构与候选领域模型](docs/architecture.md)
- [原始业务需求快照](docs/requirements/pindian-shopping-mini-program-requirements.md)
- [T001 spec](docs/tasks/T001-platform-foundation/spec.md) · [验收](docs/tasks/T001-platform-foundation/verification.md)
- [T002 spec](docs/tasks/T002-catalog-admin-media/spec.md) · [验收](docs/tasks/T002-catalog-admin-media/verification.md)
- [T003 spec](docs/tasks/T003-user-identity-address/spec.md) · [验收](docs/tasks/T003-user-identity-address/verification.md)
- [T004 spec](docs/tasks/T004-group-order-reservation/spec.md) · [验收](docs/tasks/T004-group-order-reservation/verification.md) · [业务决策记录](docs/tasks/T004-group-order-reservation/decisions/)
- [T009独立验收](docs/tasks/T009-dashboard-notification-audit/independent-verification.md)
- [T010本地模拟](docs/tasks/T010-local-wechat-simulation/verification.md)
- [T011业务验收](docs/tasks/T011-local-business-acceptance/verification.md)
- [T012发布运维](docs/tasks/T012-release-readiness/runbook.md)
- [接口契约](contracts/openapi.yaml)

## Docker 启动

需要 Node.js 24、npm 和运行中的 Docker Desktop（Linux 容器）。在项目根目录执行：

```powershell
npm ci
npm run env:init
npm run docker:up
npm run smoke:docker
```

`env:init` 仅在 .env 不存在时生成本地随机数据库密码，已有配置不会覆盖。首次安装已有锁文件，使用 npm ci。镜像构建和启动需要网络及足够磁盘空间。

- 后台：http://localhost:8080
- API 存活：http://localhost:3000/api/health/live
- 数据库就绪：http://localhost:3000/api/health/ready
- OpenAPI：http://localhost:3000/api/health/openapi
- 公开框架信息：http://localhost:3000/api/admin/v1/platform

默认所有容器发布端口绑定本机，数据库宿主端口为 5433（避开本机已有 PostgreSQL）；端口冲突时修改 .env 中 API_PORT、ADMIN_PORT、POSTGRES_PORT。修改数据库端口后同时修改 DATABASE_URL（用于本机运行 API）；Compose 容器间使用 postgres:5432，不受宿主端口影响。密码若自行修改，应使用 URL 安全的字符，并同步 DATABASE_URL；已有数据库卷的密码不会因为修改环境变量自动重置。

首次启动后创建管理员（凭据经环境变量传入，不进入源码、镜像和日志；先在 .env 中设置 ADMIN_INITIAL_USERNAME / ADMIN_INITIAL_PASSWORD）：

```powershell
npm run build
npm run admin:init          # 本机执行（读根目录 .env）
# 或容器内：docker compose exec -e ADMIN_INITIAL_USERNAME=... -e ADMIN_INITIAL_PASSWORD=... api node backend/dist/bootstrap/create-admin.js
```

随后访问 http://localhost:8080 登录即可使用：上传图片 → 新建商品（配置份额/价格/库存）→ 上架 → 小程序查看。图片保存在 Docker 命名卷 media-data；数据库迁移在 API 容器启动时自动执行（本机为 `npm run migrate`）。

备份恢复使用[scripts/release与运维说明](infra/release/README.md)，暂停写入后备份PG/媒体，校验清单并恢复到新隔离项目；不覆盖源库。

查看状态和日志：

```powershell
docker compose ps
docker compose logs --tail 60 api worker admin
```

停止环境：

```powershell
npm run docker:down
```

普通停止保留 PostgreSQL 命名卷。不要在普通停止时加删除卷选项。可选缓存用 `docker compose --profile cache up -d redis` 启动，当前应用不依赖 Redis，Redis 本轮不作为已验证的业务能力。

Worker实际执行预占过期、组截止、履约生成、支付查询补偿、退款驱动、异常统计、通知补抓、客服超时与投递任务；健康心跳证明依赖与循环可用，业务失败还需查看日志和异常队列。生产拓扑模板与HTTPS演练已提供，真实正式部署待验。

## 本机开发

先用 Docker 启动数据库，再构建工程：

```powershell
npm ci
npm run env:init
docker compose up -d postgres --wait
npm run build
```

API：`npm run dev:api` 读取根 .env，启动并监听编译产物变化。编辑后端源码时，在另一个终端运行 `npm run watch:api`，持续编译 TypeScript。先执行 build 是为了生成 contracts 的类型声明。

后台：另一个终端执行 `npm run dev:admin`，访问 http://localhost:5173。Vite 的 `/api` 代理默认指向 127.0.0.1:3000；如修改 API_PORT，同时设置 API_PROXY_TARGET。Docker API 已占用相同端口时，先停 API/Worker/admin 或使用另一个 API 端口，不关闭其他项目服务。

后台概览页默认使用真实框架 API，选择框可显式切换 Mock；商品、库存、图片、用户管理页直接对接真实后端（用户手机号默认脱敏，查看完整号与禁用/启用均记录审计）。接口失败会显示错误，不自动伪装成 Mock 成功。

## 原生小程序

用微信开发者工具导入 `apps/mini-program`，小程序根目录在其 project.config.json 中指定。project.config.json 已有项目AppID；填写AppID不等于真实登录/支付验证通过，正式环境凭据与域名仍按交接清单配置。

- 逻辑：TypeScript；视图：WXML；样式：WXSS。
- 页面按 `miniprogram/features/<功能>/pages/` 组织；T002 已实现商品列表与详情（features/catalog）。
- `platform/config.ts` 默认 mode:'api'、baseUrl 指向本地 API；商品页展示真实数据来源，mock 模式会标注"Mock 数据预览"。
- 开发者工具的本地 HTTP 联调需要按工具设置配置网络校验；仓库不默认关闭校验。
- 真机不能通过 127.0.0.1 访问电脑；正式环境需可访问的 HTTPS 地址及合法域名配置。

T011 Node装置加载实际TS页面、模拟wx能力并请求真实API，覆盖登录、支付取消/失败/权威刷新、鉴权、消息已读；与微信实际渲染/开发者工具/真机验收分别记录。

## 测试流程

```powershell
npm run test:task:t001
npm run test:task:t002
npm run test:task:t003
npm run test:task:t004
npm run smoke:docker
npm test
```

每个开发大任务先专项，通过后全量，再做隔离整体冒烟。全量入口包含所有 workspaces 类型检查、构建、源码依赖方向检查，以及 tests 下所有测试。T002 的领域规则（金额、份额、库存、权限）采用 TDD；需要 PostgreSQL 的集成测试在数据库不可达时明确 skip，不计为通过。

小程序 `platform/config.ts` 默认 mode:'api'、baseUrl 指向本地 API；“我的”页支持微信登录（需在 .env 配置 WX_APPID/WX_APP_SECRET，留空时返回未配置错误）、地址管理与昵称/手机号绑定；商品详情可选份额下单（服务端精确匹配拼单组与报价），“订单”Tab 查看订单与拼单状态。支付入口及渠道适配已有实现，本轮在本地模拟渠道验收；真实微信支付未验。开发者工具联调需配置网络校验，真机需 HTTPS 域名与合法域名配置。

## 目录与边界

```text
apps/mini-program/       微信原生用户端
apps/admin-web/          独立 Vue 管理后台
backend/src/contexts/    12 个业务/支撑上下文的目录边界
backend/src/platform/    框架只读用例、端口及适配器
backend/src/bootstrap/   API 与 Worker 装配
backend/src/workflows/   已有下单与跨领域应用流程
contracts/              公开传输类型与 OpenAPI
infra/                  Docker 健康检查与 Nginx
docs/tasks/             大任务 DDD/spec/plan/verification
docs/features/          子功能独立文档
tests/                  自动化验证
```

domain/application 不依赖框架和数据库，客户端不导入 backend 内部实现；架构检查用于发现常见违规，不替代领域设计评审。金额尾差、取消边界、库存释放和迟到支付决策在对应业务开发前确认。

## 本轮模拟与演练入口

```powershell
npm run sim:init
npm run sim:up
node scripts/simulation/smoke.mjs
# 独立库和真实API/Worker的专项
npm run test:task:t010
npm run test:task:t011
# 需要openssl、tar，自动准备Git快照包和本地HTTPS
node scripts/release/rehearsal-prepare.mjs
npm run test:task:t012
# 专项通过后
npm test
```

模拟API3300、后台8380、控制面3399都仅本机；生产禁止模拟端点。模拟控制面需ignored.env.simulation中的测试令牌；不得直接改订单为已支付。正式发布包和后续微信/服务器待办见T012 runbook。每次真实环境验收另记，不把Mock/页面逻辑/本地恢复结果写作已上线。
