# F052 DDD

复用[T014模型与UML](../../tasks/T014-support-companion/ddd.md)，无领域变更。组件属性active/thinking/compact/reducedMotion仅承载表现状态，不读取会话、密钥或业务；Chat Page通过可见性、sending及用户动效选择传入。UI布局不拥有数据库事务或权限。真人入口不伪装精灵为真人客服。
## 静止状态补充

复用既有呈现状态，不新增领域模型；减少动效作为呈现过滤优先于待命/思考，CSS特异性不能绕过静止状态。
