# T002 功能规范

依据：[需求文档](../../requirements/pindian-shopping-mini-program-requirements.md)、[AGENTS 已确认规则](../../../AGENTS.md)、[T002 DDD](ddd.md)。子功能 spec 引用本文并补充细节。

## 1. 目标、范围与非目标

**目标**：可运行的真实业务闭环——管理员登录 → 上传图片 → 创建商品与设置库存 → 上架 → 小程序浏览商品列表和详情；全部写操作经服务端权限校验，数据落 PostgreSQL，图片落 Docker 命名卷。

**范围**：后台身份与权限（F005）、商品图片资源管理（F006）、后台商品与库存管理（F007）、小程序商品列表与详情（F008）。

**非目标**（后续任务，不从项目需求中删除）：拼单匹配与份额预占、订单、微信支付与退款、履约、客服、工单、真实微信用户登录、优惠券/会员/分销。本任务小程序不提供可执行的下单/支付入口，不虚构拼单进度、参与人数或销量。

## 2. 已确认规则与假设

已确认规则（引用 AGENTS）：
- 份额以 60 单位制表达：1/2=30、1/3=20、1/4=15、1/5=12，仅允许商品配置的选项。
- 用户端整件参考售价 = 整件商品原价 + 500 分固定服务费；服务费不可配置。
- 金额一律整数分；本任务所有金额字段均为整数。
- 展示用参考价与未来实际支付报价严格区分。

本任务假设与决策（决策来源：用户 T002 授权 + AGENTS 规则推导，均可逆，后续任务可推翻但需记录）：
1. **会话机制**：服务端 DB 会话（token 原文仅登录响应返回一次，库存 sha256 哈希），绝对有效期 12 小时（`ADMIN_SESSION_TTL_MINUTES` 可配），登出即撤销；不用 JWT，不用 Cookie（`Authorization: Bearer`，天然规避 CSRF）。
2. **角色**：本期仅 `super_admin` 一个角色，拥有全部权限码（`catalog:manage`、`inventory:manage`、`media:manage`、`admin:manage`）；权限码与守卫先落地，角色体系后续任务扩展。
3. **登录限流**：同用户名连续失败 5 次锁 15 分钟（内存计数，单实例假设已记录于架构文档）；登录失败统一话术，不区分用户不存在与密码错误。
4. **图片规格**：允许 JPEG/PNG/WebP；单文件 ≤ 5 MiB；宽高均 ≥ 60px 且 ≤ 6000px；以魔数 + 图片头部解析校验“真实可解码”；超出格式界限返回 415，超大小返回 413。
5. **图片清理**：仍被商品引用的资源不可删除（409 `MEDIA_IN_USE`）；解除引用不删文件；未被引用的资源可由管理员显式删除（删元数据 + 删文件，文件删除失败仅记录告警，元数据先标记 deleted）；不做自动过期清理（规则留给后续任务）。
6. **商品状态**：存储状态仅 `draft` / `on_shelf` / `off_shelf`；“已售罄”由 `on_shelf && available==0` 推导展示；无商品删除。
7. **库存调整**：创建时设置初始库存（≥0 整数，首条变动记录）；此后 `delta`（相对）或 `setTo`（绝对）二选一 + 必填原因；`setTo` 天然幂等，`delta` 支持可选 `requestId` 幂等键（同商品同键重复请求返回当前状态不重复记账）；调整后不可为负（409）。
8. **小程序数据**：列表仅返回 `on_shelf` 商品；详情对非 `on_shelf` 商品返回 404；列表与详情不返回成本价等后台字段。
9. **未上架可见性**：草稿/下架商品绝不出现在小程序接口；“禁止不可售商品被误展示为可购买”由状态 + 上架条件双重保证。

## 3. 用户与管理场景

### 3.1 管理员

- S01 登录：输入用户名密码 → 获得 token 与资料；错误凭据 → 统一 401 提示；连续失败触发限流提示。
- S02 身份查询：刷新后台时用 token 查询 `/auth/me`；无效/过期 token → 401，前端跳登录页。
- S03 登出：撤销当前会话；重复登出幂等成功。
- S04 初始管理员：本地或容器内执行创建命令，幂等（存在则更新密码并启用），凭据只经环境变量传入。

### 3.2 图片

- S05 上传：管理后台选择本地图片 → 服务端校验 → 返回资源（含预览 URL）；非法格式/超限/不可解码给出明确错误。
- S06 管理：图片库分页查看（含是否被商品引用）；删除未引用资源。
- S07 访问：后台与小程序都能通过返回的 URL 读取图片；加载失败前端有兜底提示。

### 3.3 商品与库存

- S08 创建：填写名称、描述、原价、整件数量、计量单位、允许份额（≥1 项）、主图、详情图（≤9 张，可排序）、初始库存 → 生成草稿。
- S09 编辑：草稿/下架/上架状态均可编辑；更换主图、调整详情图顺序、移除图片关联（移除关联不删资源文件）。
- S10 上架：条件全部满足才成功；不满足返回 409 及原因清单（如“未设置主图”“库存为 0”）。
- S11 下架：随时可下架；下架后小程序立即不可见。
- S12 库存调整：输入增量或目标值 + 原因 → 更新余额并留痕；调整为负余额被拒绝；可查看变动历史。
- S13 列表与筛选：分页浏览，按状态、名称关键字筛选。

### 3.4 小程序用户

- S14 商品列表：分页浏览上架商品，展示主图、名称、整件参考价、最低份额参考价、库存状态（有货/已售罄）；支持下拉刷新与分页加载更多。
- S15 商品详情：图片（主图 + 详情图轮播）、描述、整件数量与单位、整件参考价、每个允许份额的数量与参考价、库存状态、“暂未开放购买”说明。
- S16 异常状态：加载中、空数据（无上架商品）、网络失败可重试、图片加载失败占位、商品下架后打开详情显示不可售。

## 4. API 契约（摘要；完整定义见 `contracts/openapi.yaml` 与 `contracts/src/index.ts`）

通用：响应包络 `{data, requestId}`，错误 `{code, message, requestId, details?}`；金额整数分；数量为十进制字符串（≤3 位小数）；时间 ISO 8601 UTC；分页 `{items, page, pageSize, total}`（page 从 1 起，pageSize 默认 10、上限 50）。

| 方法与路径 | 鉴权 | 说明 |
| --- | --- | --- |
| POST /api/admin/v1/auth/login | 无 | 登录，返回 token/expiresAt/admin（含权限码） |
| POST /api/admin/v1/auth/logout | Bearer | 撤销当前会话 |
| GET /api/admin/v1/auth/me | Bearer | 当前管理员资料 |
| POST /api/admin/v1/media（multipart `file`） | media:manage | 上传图片 → 资源 DTO |
| GET /api/admin/v1/media?page&pageSize | media:manage | 图片库分页（含引用计数） |
| DELETE /api/admin/v1/media/:id | media:manage | 删除未引用资源 |
| GET /api/media/v1/assets/:id | 公开 | 读取图片二进制（仅 ready；长缓存） |
| GET /api/admin/v1/products?status&keyword&page&pageSize | catalog:manage | 商品分页列表 |
| POST /api/admin/v1/products | catalog:manage | 创建草稿（含初始库存，事务） |
| GET /api/admin/v1/products/:id | catalog:manage | 商品详情 |
| PATCH /api/admin/v1/products/:id | catalog:manage | 编辑商品（字段 + 图片关联全量替换） |
| POST /api/admin/v1/products/:id/publish | catalog:manage | 上架（条件校验） |
| POST /api/admin/v1/products/:id/unpublish | catalog:manage | 下架（幂等） |
| POST /api/admin/v1/products/:id/stock-adjustments | inventory:manage | 库存调整（delta 或 setTo + reason + 可选 requestId） |
| GET /api/admin/v1/products/:id/stock-movements?page | inventory:manage | 库存变动历史 |
| GET /api/mini/v1/products?page&pageSize | 公开 | 小程序商品列表（仅上架） |
| GET /api/mini/v1/products/:id | 公开 | 小程序商品详情（仅上架） |

错误码：`VALIDATION_FAILED`(400)、`UNAUTHENTICATED`(401)、`FORBIDDEN`(403)、`NOT_FOUND`(404)、`CONFLICT`/`PRODUCT_NOT_PUBLISHABLE`/`MEDIA_IN_USE`(409)、`PAYLOAD_TOO_LARGE`(413)、`UNSUPPORTED_MEDIA_TYPE`(415)、`RATE_LIMITED`(429)、`DEPENDENCY_UNAVAILABLE`(503)、`HTTP_ERROR`(500)。

幂等语义：unpublish 重复调用幂等；publish 对已上架商品幂等返回当前状态；stock `setTo` 幂等、`delta`+`requestId` 幂等；登录、创建商品非幂等（前端按钮防重）；媒体上传每次产生新资源（不做 sha256 去重，管理员可删除未引用资源）。

## 5. 前端交互状态

管理后台（Vue 3，沿用 hash 路由）：
- 登录页：表单校验、错误提示、提交中禁用；登录后进入框架概览，导航出现商品管理入口。
- 商品管理页：列表（状态徽标、主图缩略、价格、库存）、筛选、分页、空态/失败态/重试；操作按钮按状态启用（上架仅 draft/off_shelf、下架仅 on_shelf）。
- 商品表单：新建/编辑复用；字段校验与后端一致；上传组件（选择文件 → 预览 → 进度/失败反馈）；主图单选、详情图多选可排序可移除；保存失败保留表单内容并显示原因；上架条件未满足时显示原因清单。
- 库存调整：弹层输入方式（增量/目标值）+ 原因必填；成功后刷新余额与历史；变动历史分页。

小程序（原生）：
- 列表页：骨架/加载态、下拉刷新、触底加载更多、空态（“暂无在售商品”）、失败重试；商品卡片展示主图、名称、整件参考价、“xx.xx 元起”、库存徽标。
- 详情页：轮播图（主图 + 详情图，加载失败占位）、份额卡片（数量 + 参考价，标注“参考价，拼单开放后以实际报价为准”）、库存状态、商品描述、固定底部“暂未开放购买”说明（不可点击下单）。
- 数据来源沿用 api/mock 配置；mock 数据明确标注 Mock 来源，不冒充真实接口。

## 6. 关键场景 Given/When/Then

- G1 无 token 或无效 token，W 调用任一 admin 写接口，T 401 `UNAUTHENTICATED`，不执行任何写操作。
- G2 有效 token 但权限码不符（本期无此角色数据，以守卫单测覆盖），T 403 `FORBIDDEN`。
- G3 上传扩展名伪装的文件（如 `.png` 后缀的文本），W 上传，T 415 或 400，不产生资源记录与文件。
- G4 上传 >5MiB 文件，T 413，不产生资源。
- G5 上传合法图片但数据库不可用，T 5xx 且已写文件被清理，后续无法通过任何 URL 访问该文件。
- G6 商品缺主图或库存为 0，W 上架，T 409 `PRODUCT_NOT_PUBLISHABLE` 且 message/`details` 含全部未满足原因。
- G7 商品上架后库存调整为 0，W 小程序请求列表/详情，T 仍返回商品但 `stockStatus=sold_out`，前端显示已售罄且无购买入口。
- G8 商品下架，W 小程序请求其详情，T 404。
- G9 并发两个库存调整使余额将为负，T 仅一个成功，另一请求 409，最终余额 ≥0 且两条请求各有一条明确结果（成功者有变动记录）。
- G10 同一 `requestId` 重复提交库存 delta 调整，T 仅记账一次，第二次返回当前状态 200。
- G11 容器重建（volume 保留），W 访问既有图片 URL，T 仍可读取。
- G12 管理员重复点击上架，T 幂等成功，状态保持 `on_shelf`。

## 7. 数据与环境

- 迁移：`backend/migrations/0001..0005`，由 `node backend/dist/bootstrap/migrate.js` 执行（advisory lock + `schema_migrations`）；API 容器启动命令先迁移后启动；本机 `npm run migrate`。
- 初始管理员：`npm run admin:init`（本机读 `.env`）；容器内 `docker compose exec -e … api node backend/dist/bootstrap/create-admin.js`。用户名 3–32 位（`a-z0-9_-`），密码 ≥ 10 位；脚本输出不包含密码。
- 新增环境变量：`PUBLIC_API_BASE_URL`（默认 `http://127.0.0.1:3000`，用于生成图片绝对 URL）、`MEDIA_DIR`（默认 `<repo>/data/media`，容器内 `/var/lib/pindian/media` 命名卷 `media-data`）、`ADMIN_SESSION_TTL_MINUTES`（默认 720）、`ADMIN_INITIAL_USERNAME`/`ADMIN_INITIAL_PASSWORD`（仅创建脚本读取）。
- 图片卷挂载仅 api 服务；worker 不需要媒体访问。

## 8. 验收条件（编号 AC）

- AC01 登录/登出/身份查询可用；无 token、坏 token、过期 token 的写请求全部 401；前端隐藏按钮不影响服务端拒绝（守卫单测 + HTTP 集成验证）。
- AC02 初始管理员可复现创建；凭据不进入源码、镜像、日志与错误响应。
- AC03 图片上传完整校验（魔数/解码/大小/尺寸）；非法文件不留任何可引用资源；合法上传后后台与小程序都能读取 URL。
- AC04 图片资源与商品图片关联分开：设置主图、详情图排序、移除关联；被引用资源不可删除；未引用资源可删除；移除关联不物理删文件。
- AC05 商品创建（含初始库存）原子成功；失败（如引用不存在的图片）时商品与库存都不产生。
- AC06 上架条件强制：缺字段/无主图/无库存不能上架，返回原因清单；已售罄推导正确；下架立即从小程序接口消失。
- AC07 库存调整约束：非负、留痕、幂等键生效、并发不透支（行锁 + CHECK）。
- AC08 小程序列表/详情接入真实后端：加载/空/失败/不可售状态齐备；无下单支付入口；无虚构数据；mock 模式明确标注。
- AC09 迁移可重复执行（幂等记录表）；容器重建后图片与数据仍存在。
- AC10 管理后台全流程可操作：登录→上传→建品→上架→库存调整→筛选查看，失败路径有明确反馈。
- AC11 T002 专项测试（`npm run test:task:t002`）通过后执行项目全量测试（`npm test`）通过；Docker 冒烟（`npm run smoke:docker`）通过。
- AC12 契约（contracts 类型 + OpenAPI）与实现一致；平台元数据将已实现上下文标为 `partial`，未实现上下文仍为 `planned`，`businessReady` 保持 false。

## 9. 待决策项（不阻塞本任务）

| 事项 | 本任务处理 | 决策归属 |
| --- | --- | --- |
| 份额支付报价与尾差分摊 | 仅展示参考价（half-up 到分），明确非支付报价 | 后续交易任务 |
| 履约数量拆分精度 | 展示 3 位小数，不定义拆分规则 | 后续履约任务 |
| 上架后改价对既有交易的影响 | 当前无订单允许编辑；引入订单快照后重议 | 后续交易任务 |
| 库存预留/释放生命周期 | `reserved_whole_items` 字段保留恒 0，不实现预留 | 后续交易任务 |
| 图片自动清理策略 | 不自动清理，管理员手动删未引用资源 | 后续运营任务 |
| 多角色权限体系 | 权限码 + 单角色落地 | 后续身份任务 |
| 客服图片访问控制 | 媒体读取仅商品图片场景开放公开读，客服图片后续单独定义 | 后续客服任务 |
