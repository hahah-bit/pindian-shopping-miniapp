# F006 实际验收记录

日期：2026-09-30。结论：本功能范围内验收通过（TDD 先红后绿 + 集成 + 浏览器实操 + 卷持久化）。

## 测试证据

| 验证 | 命令/操作 | 结果 |
| --- | --- | --- |
| TDD | tests/task-suites/t002/media.test.mjs（先红后绿） | 校验矩阵：合法 PNG 识别尺寸/格式；HTML 伪装 415；截断文件 415（不可解码）；<60px 400（含实际尺寸）；WebP 魔数不完整 415。上传：storageKey 服务端生成（products/{yyyy}/{uuid}.png）、URL 按环境生成、元数据与文件一致。补偿：落库失败 → 已写文件被清理。列表：分页倒序、引用计数、已删除不出现。删除：被引用 409、未引用删文件、文件删除失败仍标记删除（孤儿告警）、不存在/已删除 404 |
| HTTP 集成 | integration-db-http.test.mjs | 伪装文件 415、32×32 400、>5MiB 413；合法上传 201（format/width 正确）；公开 URL 200（image/png，字节长度一致）；被引用删除 409 `MEDIA_IN_USE`；PATCH 移除关联后删除成功；删除后公开 URL 404 |
| 浏览器实操 | 图片库页 | 元数据（PNG 640×480 300KB）、"被 1 个商品引用"徽标、删除按钮禁用；截图 artifacts/admin-media-library.png |
| 跨源访问 | curl 经 8080 代理读取图片 | 200 |
| 卷持久化 | docker compose up --build 重建（未删卷） | 图片 URL 仍 200（307669 字节），文件在 media-data 卷中 |
| 备份/恢复 | 卷 tar 备份 → 临时卷恢复 diff | 与原卷逐字节一致 |

## 未验证/边界

- WebP/JPEG 的真实文件上传在 HTTP 层以 PNG 全流程为主；JPEG/WebP 的魔数识别与尺寸解析由 ImageInspector 单测覆盖（代码路径一致），未逐格式端到端。
- 操作日志写入由集成测试计数断言（≥5 条含 media.upload/media.delete），日志内容未逐条核对。
- 对象存储端口未接实现（按 spec 保留边界）；自动清理策略未实现（spec 决策：不自动清理）。
