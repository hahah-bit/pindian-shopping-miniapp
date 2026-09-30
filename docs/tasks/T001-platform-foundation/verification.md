# T001 实际验收记录

日期：2026-09-30（Asia/Shanghai）。结论：框架源码与 Docker 本地环境验收通过；不表示业务 MVP 或微信真实环境完成。

## 实际环境

- 宿主：Windows/PowerShell；Node 24.14.1、npm 11.11.0。
- Docker 29.6.2、Compose 5.3.1；原 Linux 引擎未运行，已启动用户已有 Docker Desktop。
- 依赖已生成 package-lock，Docker 内通过 npm ci 实际安装和构建；安装审计返回 0 vulnerabilities（仅本次 registry 审计结果）。
- 核心四服务均 running/healthy：api、worker、admin、postgres。
- 后台 127.0.0.1:8080，API 127.0.0.1:3000，数据库 127.0.0.1:5433；数据库命名卷保留。

## 执行顺序与结果

| 命令/操作 | 实际结果 | 对应范围 |
| --- | --- | --- |
| npm install | 成功，安装锁文件与依赖 | AC01 |
| npm run env:init | 创建本地随机密码配置，未输出密码 | AC07 环境准备 |
| npm run test:task:t001 | 构建、mini 类型检查和架构检查通过；8 项测试全通过，0 跳过 | AC01/02/04/05/06/09 |
| docker compose config --quiet | 通过 | AC07 |
| docker compose up -d --build --wait --wait-timeout 180 | 实际镜像构建成功，四服务健康 | AC03/07/08 |
| npm run smoke:docker | 初次容器内部及 HTTP 冒烟通过；随后补查发现宿主数据库端口冲突 | AC03/05/07/08 |
| 数据库宿主连接补查 | 初次失败：本机 5432 已有 postgres 进程；保留原服务，改本项目端口为 5433并重建自身数据库容器，保留卷 | 修复环境问题 |
| npm run smoke:docker（补充本机连接检查后） | 本机及容器 PG、ready、Nginx 代理、真实 JS 资产、OpenAPI、Worker 健康全部通过 | AC03/05/07/08 |
| npm test（上述冒烟通过后） | 全部 workspace 类型检查、构建、架构检查通过；全部 8 项测试通过，0 跳过 | AC10 |
| docker compose ps | 四服务仍 healthy，PG 映射为 127.0.0.1:5433->5432 | 环境最终状态 |

本机端口修复前曾执行一次全量并通过；修复后按“相关专项冒烟 → 全量”再次验证。8 项测试包括真实 HTTP 服务启动、存活与就绪分离、数据库不可达、404、请求 ID、公开元数据、客户端失败路径、小程序页面配置、配置错误和纯应用用例。当前全量主要就是 T001 测试，不包含未实施业务的测试。

## 浏览器实际验证

使用 Codex 浏览器访问 Docker 后台：Vue 成功渲染，显示“真实框架 API”和 12 个已规划上下文；显式切换 Mock 后显示 Mock 来源；点击客服导航显示待开发提示；返回概览后恢复真实接口页面。

证据：[后台截图](artifacts/admin-preview.png)。已确认导航与来源切换可用，没有展示虚假交易操作。

## 未覆盖与边界

- 小程序通过 TypeScript 与页面配置检查，但未在微信开发者工具或真机执行；touristappid 无真实身份能力。AC06 的真实平台运行仍需后续环境验证。
- 没有登录、业务鉴权、商品管理、份额交易、真实支付、退款、履约、客服或售后业务代码。
- Worker 仅做依赖健康检查，不包含持久化任务、Outbox、到期或退款处理。
- Redis 是可选环境配置，未启动，也不是本轮核心依赖；对象存储尚未接入。
- 没有执行性能压测，不作“1000 用户可支持多少并发”的承诺；将来的交易正确性不能推迟到性能扩容阶段。
- 当前为本地 HTTP 联调，不等同于可公网正式部署的服务。
