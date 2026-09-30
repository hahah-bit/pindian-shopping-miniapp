# 拼单购物平台

原生微信小程序 + Vue 3 管理后台 + NestJS/TypeScript 模块化后端，采用 DDD 和六边形架构。

当前阶段是 **T002 商品展示、后台商品管理与图片管理（已完成）**：管理员登录、图片上传（本地卷存储）、商品创建/上下架、整件库存留痕调整、小程序商品列表与详情均已接入真实后端。拼单交易、下单、微信支付、退款、履约、客服和工单尚未实现。用户量预计不超过 1000 不等于吞吐量承诺；交易任务仍须包含事务、容量约束和幂等。

## 文档入口

- [Agent 规则](AGENTS.md)
- [整体架构与候选领域模型](docs/architecture.md)
- [原始业务需求快照](docs/requirements/pindian-shopping-mini-program-requirements.md)
- [T001 spec](docs/tasks/T001-platform-foundation/spec.md) · [验收](docs/tasks/T001-platform-foundation/verification.md)
- [T002 spec](docs/tasks/T002-catalog-admin-media/spec.md) · [计划](docs/tasks/T002-catalog-admin-media/plan.md) · [验收](docs/tasks/T002-catalog-admin-media/verification.md)
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

备份（恢复步骤见 T002 verification）：

```powershell
docker compose exec postgres pg_dump -U pindian pindian > backup/pindian.sql
docker run --rm -v pindian-platform_media-data:/data -v "${PWD}/backup:/backup" alpine sh -c "tar czf /backup/media.tgz -C /data ."
```

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

Worker 目前只检查数据库依赖并更新健康记录，不执行订单超时、退款或通知任务。Docker 为本地联调环境，正式部署还需要业务鉴权、HTTPS、真实微信配置及其他上线工作。

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

后台概览页默认使用真实框架 API，选择框可显式切换 Mock；商品、库存、图片页直接对接真实后端。接口失败会显示错误，不自动伪装成 Mock 成功。

## 原生小程序

用微信开发者工具导入 `apps/mini-program`，小程序根目录在其 project.config.json 中指定。`touristappid` 是无身份能力的预览占位，正式开发需填写自己的 AppID。

- 逻辑：TypeScript；视图：WXML；样式：WXSS。
- 页面按 `miniprogram/features/<功能>/pages/` 组织；T002 已实现商品列表与详情（features/catalog）。
- `platform/config.ts` 默认 mode:'api'、baseUrl 指向本地 API；商品页展示真实数据来源，mock 模式会标注"Mock 数据预览"。
- 开发者工具的本地 HTTP 联调需要按工具设置配置网络校验；仓库不默认关闭校验。
- 真机不能通过 127.0.0.1 访问电脑；正式环境需可访问的 HTTPS 地址及合法域名配置。

本轮 `npm run typecheck -w @pindian/mini-program` 只验证类型，原生配置测试只检查注册页面与文件存在；不代表已经通过开发者工具、真机、微信登录或支付验证。

## 测试流程

```powershell
npm run test:task:t001
npm run test:task:t002
npm run smoke:docker
npm test
```

先通过各任务专项和实际 Docker 冒烟，再运行全量。全量入口包含所有 workspaces 类型检查、构建、源码依赖方向检查，以及 tests 下所有测试。T002 的领域规则（金额、份额、库存、权限）采用 TDD；需要 PostgreSQL 的集成测试在数据库不可达时明确 skip，不计为通过。

小程序 `platform/config.ts` 默认 mode:'api'、baseUrl 指向本地 API；开发者工具联调需配置网络校验，真机需 HTTPS 域名与合法域名配置。

## 目录与边界

```text
apps/mini-program/       微信原生用户端
apps/admin-web/          独立 Vue 管理后台
backend/src/contexts/    12 个业务/支撑上下文的目录边界
backend/src/platform/    框架只读用例、端口及适配器
backend/src/bootstrap/   API 与 Worker 装配
backend/src/workflows/   未来跨领域应用流程
contracts/              公开传输类型与 OpenAPI
infra/                  Docker 健康检查与 Nginx
docs/tasks/             大任务 DDD/spec/plan/verification
docs/features/          子功能独立文档
tests/                  自动化验证
```

domain/application 不依赖框架和数据库，客户端不导入 backend 内部实现；架构检查用于发现常见违规，不替代领域设计评审。金额尾差、取消边界、库存释放和迟到支付决策在对应业务开发前确认。
