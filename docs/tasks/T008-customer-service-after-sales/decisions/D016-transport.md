# D-016 消息实时传输方式

## 决策（设计结论，2026-10-02）

**HTTP 轮询拉取**：客户端每 2s `GET messages?afterSeq=cursor` 增量拉取；服务端消息持久化 + 组内 seq 单调，断线按 cursor 补取。

- 消息机制先于传输方式设计：持久化（DB 行）、确认（seq 已读位点由拉取游标天然承载）、顺序（seq 严格递增）、幂等（clientMessageId）、重连补取（afterSeq）。
- 不引入 WebSocket/SSE：当前部署为单实例 HTTP + PG，轮询已满足"在线实时聊天"的体感（2s 内可达）；未来多实例/低延迟需求可平替为 SSE（同 seq 协议）。
