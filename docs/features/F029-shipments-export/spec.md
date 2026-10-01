# F029-shipments-export spec

> 补充说明：本文件于 2026-10-01 独立审查后补齐，记录**既已实现**的行为与规则（非先于实现的设计）；总契约见 T007 spec.md。

GET groups/:id/shipments/export → CSV（UTF-8 BOM；多包裹多行；收货明文仅此路径）；每次导出写 fulfillment.export 审计；order:manage。
