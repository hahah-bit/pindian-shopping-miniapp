# F049 验证记录（2026-10-06）

- TDD 红：catalog-discovery.test.mjs 2/2 失败，旧模型无 category、查询不传递筛选；非环境失败。
- 绿：同测试 2/2；实际 HTTP/PG 过滤验证见 catalog-http.test.mjs。
- `npm run build -w @pindian/backend`、小程序类型检查通过；独立数据库集成验证字面量关键字、AND、分页与下架隔离。
- 当前 Docker 本地栈重新构建并健康；CLI 实际导入10件、30张照片；二次运行新增0件，既有数据未覆盖。
- 素材SHA256及来源见 scripts/demo-catalog/manifest.json。照片是后端媒体资源，不依赖 Unsplash 运行时外链。
- UI/整体验收继续由 T013 执行；本记录不代替专项与全量，也不声明真机已验。

本功能独立自动化：3/3，通过，无失败/跳过。真实本地公开API读取10件、30张媒体均200且 image MIME，有证据；当前渠道和真机不包含在该计数。
