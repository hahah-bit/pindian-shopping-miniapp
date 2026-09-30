# 领域分析

复用 [T001 DDD 与 UML](../../tasks/T001-platform-foundation/ddd.md)。DatabaseProbe 是出站端口，CheckReadiness 是纯应用用例，HealthController 是入站适配器；PostgresProbe 管理连接池生命周期。无交易实体或数据表变更。
