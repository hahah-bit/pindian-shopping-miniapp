# F030-mini-fulfillment spec

> 补充说明：本文件于 2026-10-01 独立审查后补齐，记录**既已实现**的行为与规则（非先于实现的设计）；总契约见 T007 spec.md。

GET orders/:id/fulfillment（本人、他人 404、未生成空态、展示原单位文本与收货原文）+ POST fulfillment-orders/:id/confirm-receipt（本人、shipped、幂等、completed_by=user）。
