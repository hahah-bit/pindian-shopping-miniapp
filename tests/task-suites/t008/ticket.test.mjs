import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let Ticket;
let CreateTicketUseCase;
let ProcessTicketUseCase;
let RequestTicketRefundUseCase;
let ConvertConversationToTicketUseCase;
try {
  ({ Ticket } = require('../../../backend/dist/contexts/after-sales/domain/ticket.js'));
  ({ CreateTicketUseCase, ProcessTicketUseCase } = require('../../../backend/dist/contexts/after-sales/application/ticket-usecases.js'));
  ({ RequestTicketRefundUseCase, ConvertConversationToTicketUseCase } = require('../../../backend/dist/contexts/after-sales/application/ticket-coordination.js'));
} catch { /* 未实现：全红 */ }

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-7777-4777-8777-000000000001';
const TID = 'bbbbbbbb-7777-4777-8777-000000000001';
const ADMIN = 'dddddddd-7777-4777-8777-000000000001';
const ORDER = 'cccccccc-7777-4777-8777-000000000001';
const CID = 'eeeeeeee-7777-4777-8777-000000000001';

class InlineRunner { async run(w) { return w({ tx: 1 }); } }

class FakeTicketRepository {
  constructor(ticket) { this.ticket = ticket ?? null; this.actions = []; }
  async findByIdForUpdate() { return this.ticket; }
  async findById() { return this.ticket; }
  async insert(t) { this.ticket = t; }
  async save(t) { this.ticket = t; }
  async insertAction(ticketId, action) { this.actions.push(action); }
}

class FakeRefundPort {
  constructor(eligible = true) { this.eligible = eligible; this.calls = []; this.refundId = 'aaaaaaaa-9999-4999-8999-000000000001'; }
  async checkRefundable(input) { this.calls.push({ ...input }); return this.eligible ? { refundable: true } : { refundable: false, reason: '订单已全额退款' }; }
  async createFullRefund(input) { this.calls.push({ ...input }); return { refundId: this.refundId }; }
}

class FakeConversationRepository {
  constructor(conversation) { this.conversation = conversation ?? null; this.saved = []; }
  async findByIdForUpdate() { return this.conversation; }
  async save(c) { this.conversation = c; this.saved.push(c); }
}

function makeTicket(status = 'open') {
  return Ticket.create({ ticketId: TID, userId: USER, conversationId: null, type: 'refund_issue', title: '退款问题', description: '描述', relatedOrderId: ORDER, now: NOW, status });
}

test('创建工单（异步）：入库 open + 初始 action', async () => {
  const repo = new FakeTicketRepository();
  const useCase = new CreateTicketUseCase({ tickets: repo, references: {assertOwned:async()=>{}}, runner: new InlineRunner(), clock: { now: () => NOW } });
  const result = await useCase.execute({ userId: USER, type: 'refund_issue', title: '退款问题', description: '描述', orderId: ORDER });
  assert.equal(result.ticket.state.status, 'open');
  assert.equal(repo.actions[0]?.action, 'create');
});

test('非法类型拒绝；标题/描述必填', async () => {
  const repo = new FakeTicketRepository();
  const useCase = new CreateTicketUseCase({ tickets: repo, references: {assertOwned:async()=>{}}, runner: new InlineRunner(), clock: { now: () => NOW } });
  await assert.rejects(() => useCase.execute({ userId: USER, type: 'hack', title: 't', description: 'd' }), (e) => e.code === 'VALIDATION_FAILED');
  await assert.rejects(() => useCase.execute({ userId: USER, type: 'other', title: '', description: 'd' }), (e) => e.code === 'VALIDATION_FAILED');
});

test('状态机：open→processing→resolved；closed 可提前；resolved/closed 终态拒绝再处理', async () => {
  const repo = new FakeTicketRepository(makeTicket());
  const useCase = new ProcessTicketUseCase({ tickets: repo, runner: new InlineRunner(), clock: { now: () => NOW } });
  const accepted = await useCase.execute({ ticketId: TID, action: 'accept', adminId: ADMIN });
  assert.equal(accepted.ticket.state.status, 'processing');
  const resolved = await useCase.execute({ ticketId: TID, action: 'resolve', adminId: ADMIN, detail: { reply: '已解决' } });
  assert.equal(resolved.ticket.state.status, 'resolved');
  await assert.rejects(() => useCase.execute({ ticketId: TID, action: 'reply', adminId: ADMIN, detail: { text: 'x' } }), (e) => e.code === 'TICKET_STATE_CONFLICT');
});

test('open 直接关闭允许；重复关闭幂等', async () => {
  const repo = new FakeTicketRepository(makeTicket('open'));
  const useCase = new ProcessTicketUseCase({ tickets: repo, runner: new InlineRunner(), clock: { now: () => NOW } });
  await useCase.execute({ ticketId: TID, action: 'close', adminId: ADMIN, isSupervisor:true, detail: { reason: '重复提交' } });
  await useCase.execute({ ticketId: TID, action: 'close', adminId: ADMIN, isSupervisor:true, detail: { reason: '重复提交' } });
  assert.equal(repo.ticket.state.status, 'closed');
});

test('发起退款：经支付公开用例创建全额退款并记录 action；不可退 → 409 且无 action', async () => {
  // 可退路径
  const repo = new FakeTicketRepository(makeTicket('processing'));
  const refundPort = new FakeRefundPort(true);
  const refundUseCase = new RequestTicketRefundUseCase({ tickets: repo, refundPort, runner: new InlineRunner(), clock: { now: () => NOW } });
  const result = await refundUseCase.execute({ ticketId: TID, orderId: ORDER, adminId: ADMIN, requestId: 'r1' });
  assert.equal(result.refundId, refundPort.refundId);
  assert.equal(repo.actions.some((a) => a.action === 'request_refund'), true);
  // 不可退路径：409 且工单无半条 action
  const repo2 = new FakeTicketRepository(makeTicket('processing'));
  const failingPort = new FakeRefundPort(false);
  const failingUseCase = new RequestTicketRefundUseCase({ tickets: repo2, refundPort: failingPort, runner: new InlineRunner(), clock: { now: () => NOW } });
  await assert.rejects(() => failingUseCase.execute({ ticketId: TID, orderId: ORDER, adminId: ADMIN, requestId: 'r2' }), (e) => e.code === 'REFUND_NOT_ALLOWED');
  assert.equal(repo2.actions.filter((a) => a.action === 'request_refund').length, 0, '资格校验失败不留半条 action');
});

test('转工单：open 工单创建 + 会话 converted；converted 会话只读', async () => {
  const conversation = (await import('node:assert')).strict;
  void conversation;
  const convRepo = new FakeConversationRepository(
    (require('../../../backend/dist/contexts/customer-service/domain/conversation.js')).Conversation.create({ conversationId: CID, userId: USER, now: NOW, status: 'active', assignedAgentId: ADMIN })
  );
  const ticketRepo = new FakeTicketRepository();
  const useCase = new ConvertConversationToTicketUseCase({ tickets: ticketRepo, conversations: convRepo, runner: new InlineRunner(), clock: { now: () => NOW } });
  const result = await useCase.execute({ conversationId: CID, agentId: ADMIN, type: 'shipment_issue', title: '发货问题', description: '迟迟未发货' });
  assert.equal(result.ticket.state.status, 'open');
  assert.equal(convRepo.conversation.state.status, 'converted');
  assert.equal(convRepo.conversation.state.ticketId, result.ticket.state.ticketId);
});
