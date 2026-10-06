# 商品搜索分类与演示素材实施

## 2026-10-06 装配细化

演示导入使用受 local 环境保护的 backend/bootstrap CLI，通过 Nest 装配的 UploadMediaAsset、CreateProductWorkflow、PublishProductWorkflow 与审计用例执行；不要求用户提供后台密码、不重置管理员。数据库仅用于导入 advisory lock，商品和库存写入继续走公开应用用例。商品 description 带固定导入标识，媒体 ID 进本地媒体目录检查点，重跑恢复半途草稿且不重置已售/已编辑商品；CLI 不提供 HTTP 免认证入口。素材清单只在导入时由参数传入，不进入小程序包。

依赖 [DDD](ddd.md)、[spec](spec.md)，覆盖 AC01/02。

采用 TDD：分类校验、查询组合和公开下架隔离先失败后实现；导入脚本实现后真实 HTTP 冒烟，重跑必须0新增。

1. 定义公开契约、输入限制、错误码与失败状态。
2. 按 backend/src/contexts/catalog、backend/src/workflows/catalog-queries.ts、contracts、scripts/demo-catalog 实施端口/适配器/页面，保持领域依赖方向。
3. 存储与环境：分类与 Product 同事务保存，迁移0029新增默认字段，不改变价格和既有组。导入仅 local 环境，素材清单固定指纹，管理员接口上传/创建/上架，失败可重跑不覆盖旧商品。
4. 执行 tests/task-suites/t013 对应功能测试及真实接口冒烟；整体专项通过后 npm test。
5. 记录实际结果和未验项，精确暂存并中文 feature 提交，继续下一功能。
