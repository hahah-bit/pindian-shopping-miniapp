-- 发送身份是消息幂等范围的一部分；旧客服消息作者未知，不从当前负责客服倒推。
ALTER TABLE cs_messages ADD COLUMN actor_id uuid;
UPDATE cs_messages m SET actor_id = c.user_id FROM cs_conversations c
WHERE m.conversation_id = c.id AND m.sender = 'user';
ALTER TABLE cs_messages DROP CONSTRAINT cs_messages_conversation_id_client_message_id_key;
CREATE UNIQUE INDEX cs_messages_actor_client_idx
ON cs_messages(conversation_id, sender, actor_id, client_message_id);
