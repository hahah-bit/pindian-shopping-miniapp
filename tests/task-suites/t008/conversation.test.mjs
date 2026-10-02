import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let Conversation;
let AppendMessageUseCase;
let AcceptConversationUseCase;
let CreateConversationUseCase;
let ApplicationError;
try {
  ({ Conversation } = require('../../../backend/dist/contexts/customer-service/domain/conversation.js'));
  ({ CreateConversationUseCase, AppendMessageUseCase } = require('../../../backend/dist/contexts/customer-service/application/conversation-usecases.js'));
  ({ AcceptConversationUseCase } = require('../../../backend/dist/contexts/customer-service/application/agent-usecases.js'));
  ({ ApplicationError } = require('../../../backend/dist/shared/kernel.js'));
} catch { /* 未实现：全红 */ }

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-6666-4666-8666-000000000001';
const CID = 'cccccccc-6666-4666-8666-000000000001';
const AGENT1 = 'dddddddd-6666-4666-8666-000000000001';
const AGENT2 = 'dddddddd-6666-4666-8666-000000000002';

class InlineRunner { async run(w) { return w({ tx: 1 }); } }

class FakeConversationRepository {
  constructor(conversation) { this.conversation = conversation ?? null; this.saved = []; }
  async findByIdForUpdate() { return this.conversation; }
  async findById() { return this.conversation; }
  async findOpenByUserId(userId) { return this.conversation && this.conversation.state.userId === userId && ['queued', 'active'].includes(this.conversation.state.status) ? this.conversation : null; }
  async save(c) { this.conversation = c; this.saved.push(c); }
  async insert(c) { this.conversation = c; }
  async findLastSeq() { return this.conversation ? this.conversation.state.lastSeq : 0; }
  async findDuplicate(clientMessageId) { return this.duplicate ?? null; }
  async insertMessage(message) {
    if (this.failInsert) throw this.failError;
    this.messages = this.messages ?? [];
    if (this.messages.some((m) => m.seq === message.seq)) throw new Error('duplicate seq');
    this.messages.push(message);
  }
}

function makeConversation(status = 'queued', agent = null) {
  return Conversation.create({ conversationId: CID, userId: USER, now: NOW, status, assignedAgentId: agent });
}

function buildMessageDeps(conversation) {
  const repo = new FakeConversationRepository(conversation);
  const useCase = new AppendMessageUseCase({ conversations: repo, runner: new InlineRunner(), clock: { now: () => new Date(NOW.getTime() + 1000) } });
  return { repo, useCase };
}

test('发起会话：无未结束会话 → queued 入队；已有未结束会话幂等返回原会话', async () => {
  const repo = new FakeConversationRepository();
  const useCase = new CreateConversationUseCase({ conversations: repo, runner: new InlineRunner(), clock: { now: () => NOW } });
  const first = await useCase.execute({ userId: USER });
  assert.equal(first.conversation.state.status, 'queued');
  const second = await useCase.execute({ userId: USER });
  assert.equal(second.conversation.state.conversationId, first.conversation.state.conversationId, '幂等返回原会话');
});

test('发消息：seq 单调递增；重复 clientMessageId 幂等返回原消息不新增', async () => {
  const { repo, useCase } = buildMessageDeps(makeConversation('active', AGENT1));
  const m1 = await useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'cm-1', kind: 'text', content: { text: '你好' }, sender: 'user' });
  assert.equal(m1.message.seq, 1);
  repo.duplicate = m1.message;
  const m2 = await useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'cm-1', kind: 'text', content: { text: '你好' }, sender: 'user' });
  assert.equal(m2.message.seq, 1, '幂等返回原 seq');
  assert.equal((repo.messages ?? []).length, 1, '不新增');
});

test('ended/converted 会话拒发消息（CONVERSATION_ENDED 409）', async () => {
  const { useCase } = buildMessageDeps(makeConversation('ended'));
  await assert.rejects(
    () => useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'cm-x', kind: 'text', content: { text: 'hi' }, sender: 'user' }),
    (e) => e.code === 'CONVERSATION_ENDED'
  );
});

test('越权：非本人用户向会话发消息/拉取 → NOT_FOUND', async () => {
  const { useCase } = buildMessageDeps(makeConversation('active', AGENT1));
  await assert.rejects(
    () => useCase.execute({ conversationId: CID, userId: 'someone-else', clientMessageId: 'cm-y', kind: 'text', content: { text: 'hi' }, sender: 'user' }),
    (e) => e.code === 'NOT_FOUND'
  );
});

test('消息校验：text 超长 / 空 content / 非法 kind 拒绝', async () => {
  const { useCase } = buildMessageDeps(makeConversation('active', AGENT1));
  await assert.rejects(() => useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'a', kind: 'text', content: { text: 'x'.repeat(2001) }, sender: 'user' }), (e) => e.code === 'VALIDATION_FAILED');
  await assert.rejects(() => useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'b', kind: 'text', content: {}, sender: 'user' }), (e) => e.code === 'VALIDATION_FAILED');
  await assert.rejects(() => useCase.execute({ conversationId: CID, userId: USER, clientMessageId: 'c', kind: 'voice', content: { text: 'x' }, sender: 'user' }), (e) => e.code === 'VALIDATION_FAILED');
});

test('接入：queued→active（assignedAgent）；并发/重复接入非 queued → CONVERSATION_NOT_QUEUED', async () => {
  const repo = new FakeConversationRepository(makeConversation());
  const useCase = new AcceptConversationUseCase({ conversations: repo, runner: new InlineRunner(), clock: { now: () => NOW } });
  const accepted = await useCase.execute({ conversationId: CID, agentId: AGENT1 });
  assert.equal(accepted.conversation.state.status, 'active');
  assert.equal(accepted.conversation.state.assignedAgentId, AGENT1);
  await assert.rejects(
    () => useCase.execute({ conversationId: CID, agentId: AGENT2 }),
    (e) => e.code === 'CONVERSATION_NOT_QUEUED'
  );
});

test('客服回复：仅分配给自己的 active 会话；内部备注 internal=true 用户不可见', async () => {
  const { repo, useCase } = buildMessageDeps(makeConversation('active', AGENT1));
  const reply = await useCase.execute({ conversationId: CID, agentId: AGENT1, clientMessageId: 'ag-1', kind: 'text', content: { text: '您好' }, sender: 'agent' });
  assert.equal(reply.message.sender, 'agent');
  await assert.rejects(
    () => useCase.execute({ conversationId: CID, agentId: AGENT2, clientMessageId: 'ag-2', kind: 'text', content: { text: '越权' }, sender: 'agent' }),
    (e) => e.code === 'NOT_FOUND'
  );
  const note = await useCase.execute({ conversationId: CID, agentId: AGENT1, clientMessageId: 'ag-3', kind: 'note', content: { text: '内部备注' }, sender: 'agent' });
  assert.equal(note.message.internal, true);
});
