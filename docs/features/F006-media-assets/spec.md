# F006 spec

上游：[T002 spec](../../tasks/T002-catalog-admin-media/spec.md) §2（决策 4–5）、§3.2、§4（media 契约）、§6 G3–G5、G11。本文件细化验收条件。

## 接口契约细节

- `POST /api/admin/v1/media`：multipart 字段名 `file`；multer 内存存储，单文件上限 5 MiB（超出 413）；权限 `media:manage`。成功 201 `MediaAssetView {id, url, format, width, height, sizeBytes, createdAt}`。
- `GET /api/admin/v1/media?page&pageSize`：分页 `MediaAssetAdminView`（含 `referencedByProducts` 计数与缩略 `url`），按创建时间倒序。
- `DELETE /api/admin/v1/media/:id`：被引用 → 409 `MEDIA_IN_USE`；不存在 → 404；成功 → 200 `{deleted: true}`。
- `GET /api/media/v1/assets/:id`：公开；仅 `ready`；不存在/已删除 → 404；返回二进制 + Content-Type + 长缓存头；支持 HEAD。
- 上传操作写 OperationLog（`media.upload`、`media.delete`，含 mediaId/大小/格式，不含文件内容）。

## 上传校验规则（服务端）

1. 必须有文件与内容；空文件 400。
2. 魔数不在 JPEG/PNG/WebP → 415 `UNSUPPORTED_MEDIA_TYPE`。
3. 头部解析不出尺寸（损坏/截断）→ 415（视为不可解码）。
4. 宽或高 < 60 或 > 6000 → 400 `VALIDATION_FAILED`（消息含实际尺寸）。
5. > 5 MiB → 413（multer 层拦截）。
6. 一律服务端生成 storageKey；客户端文件名只作日志参考，不参与存储路径。

## 失败与补偿

- 存储写入失败 → 500，无数据库记录。
- 元数据落库失败 → 删除已写文件后返回失败；任何 URL 都无法引用该文件。
- 删除资源：引用计数 > 0 拒绝；成功先标记 deleted 再删文件；文件删除失败不影响响应（已不可引用），记录服务端告警。

## 前端行为（后台）

- 上传组件：选择文件 → 立即上传 → 预览（成功）/错误信息（失败，按 400/413/415/网络区分）；上传中禁用；多文件顺序上传。
- 图片库页：分页网格、引用徽标、删除需确认（被引用时按钮禁用并提示）。
- 商品表单内：上传后加入候选；主图单选；详情图拖拽/按钮排序（≤9 张）；移除关联仅解除引用（资源仍在图片库）。

## 小程序行为

- `<image>` 展示接口返回的绝对 URL；`binderror` 显示占位图与“图片加载失败”；列表主图与详情轮播一致处理。

## 验收条件

- AC-F06-1 合法 JPEG/PNG/WebP 上传成功，元数据（格式/宽高/大小）与文件一致，URL 立即可公开读取。
- AC-F06-2 伪装扩展名（文本/HTML/脚本）→ 415，无记录无文件。
- AC-F06-3 截断 PNG（头部可读但结构损坏按解析器判定）→ 415。
- AC-F06-4 超尺寸（<60 或 >6000 边）→ 400，消息含尺寸。
- AC-F06-5 超 5 MiB → 413，无记录。
- AC-F06-6 元数据落库失败（仓储抛错注入）→ 文件被清理（补偿单测）。
- AC-F06-7 被商品引用的资源 DELETE → 409 `MEDIA_IN_USE`；移除关联后可删除。
- AC-F06-8 删除后公开 URL → 404；`GET /api/admin/v1/media` 不再出现。
- AC-F06-9 URL 由 `PUBLIC_API_BASE_URL` 生成；后台（同源 /api 代理）与小程序（绝对地址）均可访问（集成验证）。
- AC-F06-10 容器重建后既有图片 URL 仍可读（卷持久化，联调验证）。
- AC-F06-11 上传/删除操作在 OperationLog 有记录；日志不含图片二进制。
