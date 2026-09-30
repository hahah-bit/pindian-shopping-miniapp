# F006 DDD

复用 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md) §2.2（MediaAsset 不变量）、§5（类图）、§6.2（上传时序）、§7（端口与存储设计）。本文件补充细节，无超出大任务的领域变更。

## 模型细节

- `MediaAsset` 是独立聚合根：不依赖商品存在；商品通过 `ProductImage`（属于 Product 聚合）以 `mediaId` 引用。资源不可变——重传即新资源，`status` 仅 `ready → deleted` 一条迁移（删除且未被引用时）。
- 校验规则（领域纯函数 `validateImage(buffer)`）：
  1. 大小 1 B..5 MiB；
  2. 魔数识别：JPEG `FFD8FF`、PNG `89 50 4E 47 0D 0A 1A 0A`、WebP `RIFF....WEBP`；其他 → 415；
  3. 头部可解析出宽高（image-size 解析失败 = 不可解码 → 415）；
  4. 宽高各在 [60, 6000] 像素。
- `storageKey = products/{yyyy}/{uuidv4}.{jpg|png|webp}`，由服务端生成；扩展名来自检测格式而非客户端文件名。
- 访问 URL 由 `MediaUrlBuilder`（应用端口，适配器用 `PUBLIC_API_BASE_URL` 实现）在响应时生成：`{base}/api/media/v1/assets/{mediaId}`；落库仅 storageKey。

## 端口

`ImageStorage`（put/delete/open，本地文件适配器实现，路径拼接防穿越）、`MediaRepository`（插入/按 ID 查/分页含引用计数/标记删除/统计引用）、`MediaUrlBuilder`。上传用例编排：校验 → storage.put → repo.insert（失败补偿 storage.delete）。公开读取控制器经 `ImageStorage.open` 流式返回，`Content-Type` 与 `Cache-Control: public, max-age=31536000, immutable`（资源不可变，id 一次分配内容固定）。

## 事务边界与失败路径

上传无跨聚合事务：文件与元数据两步写入 + 补偿删除（见 T002 §6.2）。删除：先查引用计数（>0 → 409），再标记 deleted（条件更新 `status='ready' AND 无引用`），成功后删文件；文件删除失败记录告警，元数据已 deleted 不可再引用（一致性以数据库为准，孤儿文件允许存在并可人工清理——与“仍被引用不能删”的方向一致，宁多文件不破坏引用）。

## 明确不做

不做 sha256 去重、裁剪/压缩/水印、EXIF 处理、对象存储接入（仅保留端口）、客服图片公开读（后续任务单独定义访问控制）。
