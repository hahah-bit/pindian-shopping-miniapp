# F006 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T002 plan](../../tasks/T002-catalog-admin-media/plan.md) S4。

## 测试策略

采用 TDD：校验、补偿、引用约束是可自动验证的业务规则（AGENTS 2.2.1，金额/约束类）。纯内存/临时目录先行：`tests/task-suites/t002/media.test.mjs` 覆盖校验矩阵、补偿、删除约束；HTTP 层（multipart、413、公开读取）进集成测试。通过标准：单测全绿 + 集成相关断言通过 + 浏览器上传实操。

合法测试图片以代码生成最小 PNG/JPEG 字节（固定 8x8 放大至 ≥60 需手工构造或用超阈值假数据走纯校验函数分支——尺寸下限仅校验函数层覆盖，端到端用 64x64 纯色 PNG 常量）。

## 步骤

- [ ] P1 迁移 0003（media_assets：storage_key 唯一、status、尺寸/大小 CHECK）。
- [ ] P2 contracts：MediaAssetView/MediaAssetAdminView + OpenAPI 片段。
- [ ] P3 TDD 领域：`validateImage`（魔数/尺寸/大小矩阵）、MediaAsset 工厂（storageKey 生成、不可变）。测试先行。
- [ ] P4 TDD 应用：UploadMediaAsset（校验→put→insert→补偿）、ListMediaAssets（引用计数）、DeleteMediaAsset（引用→标记→文件）；MediaUrlBuilder 端口。假仓储/假存储测试先行。
- [ ] P5 适配器：LocalImageStorage（MEDIA_DIR、防路径穿越、原子写入 temp+rename）、pg MediaRepository、ConfigMediaUrlBuilder。
- [ ] P6 入口：MediaController（multer FileInterceptor、大小限制、错误映射 413/415/400）、公开 MediaAccessController（流式 + 缓存头）；compose media 卷、Dockerfile 目录与权限、env 变量。
- [ ] P7 前端：上传组件（进度/失败反馈）、图片库页、商品表单集成点（主图/排序/移除）。
- [ ] P8 验证：单测证据 → 集成（上传→建品引用→删除约束→公开读）→ 容器重建持久化 → 浏览器实操；回写 verification.md。

## 完成标准

spec AC-F06-1..11 满足；T002 plan S4 勾选；图片不进入 PostgreSQL 二进制列。
