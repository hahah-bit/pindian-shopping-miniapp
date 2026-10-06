# 本地演示商品

10 个商品、每个 3 张不同网络照片。照片来自 Unsplash，原始页面、下载地址、许可、SHA256 和时间见 manifest.json；只用于自用演示，无产地、认证、销量承诺。不是运行时外链，不占小程序包。

素材已下载；可用 `node scripts/demo-catalog/download.mjs` 重新获取（更新指纹后应复查）。导入复用现有上传、商品、库存和发布用例，不重置管理员，不改历史交易，仅 APP_ENV=local 可执行。

```powershell
docker compose cp scripts/demo-catalog api:/tmp/demo-catalog
docker compose exec -T api node backend/dist/bootstrap/seed-demo-catalog.js /tmp/demo-catalog/manifest.json
```

重跑优先按媒体检查点中的商品ID查重，兼容按固定描述标识恢复，已存在的商品跳过，半途草稿恢复上架。媒体目录保留检查点，导入失败可重跑。清单和本地照片长期保留以支持离线重建；不得将演示导入作为正式生产数据迁移。
