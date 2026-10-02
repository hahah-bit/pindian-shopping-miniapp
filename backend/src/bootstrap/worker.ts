import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundationModule } from './foundation.module';
import { CheckReadiness } from '../platform/application/check-readiness/check-readiness';
import { ExpireReservationsTask, FailDeadlineGroupsTask } from '../workflows/order-expiry.tasks';
import { PaymentQueryCompensationTask, RefundDriveTask, AnomalyStatsTask } from '../workflows/payment-tasks';
import { ConfirmPaymentWorkflow } from '../workflows/payment-confirm.workflow';
import { CreateFullRefundUseCase } from '../contexts/payments/application/refund-flow';
import { FulfillmentGenerationTask } from '../workflows/fulfillment-generation.task';
import { PostgresFulfillmentRepository } from '../contexts/fulfillment/adapters/outbound/postgres/fulfillment-repository';
import { PostgresGroupRepository, PostgresShareReservationRepository } from '../contexts/group-buying/adapters/outbound/postgres/group-repositories';
import { PostgresOrderRepository } from '../contexts/ordering/adapters/outbound/postgres/order-repository';
import { PostgresPaymentRepository } from '../contexts/payments/adapters/outbound/postgres/payment-repository';
import { PostgresRefundRepository } from '../contexts/payments/adapters/outbound/postgres/refund-repository';
import { getStockReservationPort } from '../contexts/catalog/adapters/outbound/catalog-stock-adapters';
import { Pool } from 'pg';
import { readConfig } from './config';
import { DriveDeliveries } from '../contexts/notifications/application/delivery-driver';
import { ScanTimeoutConversations } from '../contexts/notifications/application/timeout-reminder';
import { CatchUpBusinessEvents } from '../contexts/notifications/application/event-catchup';
import { PostgresNotificationRepository } from '../contexts/notifications/adapters/outbound/postgres/notification-repository';
import { PostgresNotificationScanPort } from '../contexts/notifications/adapters/outbound/postgres/scan-ports';
import { UnconfiguredChannelAdapter } from '../contexts/notifications/adapters/outbound/channel/unconfigured-channel';
import { RecordNotification } from '../contexts/notifications/application/record-notification';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(FoundationModule);
  const readiness = app.get(CheckReadiness);
  // T004 到期任务：状态全在 DB，服务重启后自动恢复；异常记录后下轮重试
  const pool = new Pool({ connectionString: readConfig().databaseUrl, max: 2 });
  const expiryDeps = {
    groups: new PostgresGroupRepository(pool),
    reservations: new PostgresShareReservationRepository(pool),
    orders: new PostgresOrderRepository(pool),
    stocks: getStockReservationPort(pool),
    runner: { async run<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const r = await work(client); await client.query('COMMIT'); return r; }
      catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; }
      finally { client.release(); }
    } },
    clock: { now: () => new Date() }
  };
  const expireTask = new ExpireReservationsTask(expiryDeps);
  // T006 支付任务（D010 单 Worker 循环五任务；状态全在 DB，重启自动恢复）
  const payments = new PostgresPaymentRepository(pool);
  const refunds = new PostgresRefundRepository(pool);
  const payChannel = app.get<import('../contexts/payments/application/ports').PaymentChannelPort>('PAY_CHANNEL_PORT');
  const refundCreator = new CreateFullRefundUseCase({ refunds, payments, clock: expiryDeps.clock });
  // 组截止（复验 A02）：失效后为已支付订单创建 group_failed 全额退款（幂等重扫）
  const deadlineTask = new FailDeadlineGroupsTask({ ...expiryDeps, payments, refunds: { createFullRefund: (input, sessionTx) => refundCreator.execute(input, sessionTx) } });
  const confirm = new ConfirmPaymentWorkflow({
    groups: expiryDeps.groups,
    reservations: expiryDeps.reservations,
    orders: expiryDeps.orders,
    payments,
    refunds: { createFullRefund: (input, sessionTx) => refundCreator.execute(input, sessionTx) },
    stocks: expiryDeps.stocks,
    runner: expiryDeps.runner,
    clock: expiryDeps.clock
  });
  // T007 履约生成（D012）：success 组 → 每 paid 订单一张履约单（组级事务、幂等重扫）
  const fulfillmentRepo = new PostgresFulfillmentRepository(pool);
  const fulfillmentGenTask = new FulfillmentGenerationTask({ scan: fulfillmentRepo, fulfillmentOrders: fulfillmentRepo, runner: expiryDeps.runner, clock: expiryDeps.clock });
  const payQueryTask = new PaymentQueryCompensationTask({ payments, channel: payChannel, confirm, runner: expiryDeps.runner, clock: expiryDeps.clock });
  const refundDriveTask = new RefundDriveTask({ refunds, payments, channel: payChannel, runner: expiryDeps.runner, clock: expiryDeps.clock });
  const anomalyTask = new AnomalyStatsTask({
    countPendingReviewPayments: () => payments.countByStatus('pending_review'),
    countFailedRefunds: () => refunds.countFailedRefunds()
  });
  // T009 通知任务（D021/D022/D026）：事件补抓 → 超时提醒 → 投递驱动；状态全在 DB，重启自动恢复
  const notificationRepo = new PostgresNotificationRepository(pool);
  const notificationRecorder = new RecordNotification({ repository: notificationRepo, clock: expiryDeps.clock });
  const notificationScan = new PostgresNotificationScanPort(pool);
  const eventCatchupTask = new CatchUpBusinessEvents({ scanPort: notificationScan, recorder: notificationRecorder });
  const timeoutReminderTask = new ScanTimeoutConversations({ scanPort: notificationScan, recorder: notificationRecorder, clock: expiryDeps.clock, thresholdMinutes: readConfig().csFirstResponseTimeoutMinutes });
  const deliveryDriveTask = new DriveDeliveries({ repository: notificationRepo, channels: [new UnconfiguredChannelAdapter()], clock: expiryDeps.clock });
  const healthDir = process.env.WORKER_HEALTH_DIR ?? join(tmpdir(), 'pindian-worker');
  await mkdir(healthDir, { recursive: true });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log('[worker] 业务任务循环启动：预占过期 / 组截止 / 履约生成 / 支付查询补偿 / 退款驱动 / 异常统计 / 通知事件补抓 / 客服超时提醒 / 通知投递驱动');
  try {
    while (!stopping) {
      const ready = await readiness.execute();
      await writeFile(join(healthDir, 'health.json'), JSON.stringify({ ready, checkedAt: Date.now(), businessTasksEnabled: true }));
      if (!ready) console.error('[worker] 数据库依赖不可用');
      else {
        try { const n = await expireTask.execute({ limit: 200 }); if (n > 0) console.log(`[worker] 预占过期处理 ${n} 笔`); }
        catch (e) { console.error('[worker] 预占过期任务失败', e instanceof Error ? e.message : e); }
        try { const n = await deadlineTask.execute({ limit: 200 }); if (n > 0) console.log(`[worker] 组截止处理 ${n} 组`); }
        catch (e) { console.error('[worker] 组截止任务失败', e instanceof Error ? e.message : e); }
        try { const n = await fulfillmentGenTask.execute({ limit: 20 }); if (n > 0) console.log(`[worker] 履约单生成 ${n} 组`); }
        catch (e) { console.error('[worker] 履约生成任务失败', e instanceof Error ? e.message : e); }
        try { const n = await payQueryTask.execute({ limit: 100 }); if (n > 0) console.log(`[worker] 支付查询补偿确认 ${n} 笔`); }
        catch (e) { console.error('[worker] 支付查询补偿失败', e instanceof Error ? e.message : e); }
        try { const n = await refundDriveTask.execute({ limit: 100 }); if (n > 0) console.log(`[worker] 退款驱动处理 ${n} 笔`); }
        catch (e) { console.error('[worker] 退款驱动失败', e instanceof Error ? e.message : e); }
        try {
          const stats = await anomalyTask.execute();
          if (stats.pendingReviewPayments > 0 || stats.failedRefunds > 0) console.log(`[worker] 异常待人工：待复核支付 ${stats.pendingReviewPayments} 笔，失败退款 ${stats.failedRefunds} 笔`);
        }
        catch (e) { console.error('[worker] 异常统计失败', e instanceof Error ? e.message : e); }
        try { const n = await eventCatchupTask.execute({ limit: 100 }); if (n.created > 0) console.log(`[worker] 通知事件补抓 ${n.created} 条`); }
        catch (e) { console.error('[worker] 通知事件补抓失败', e instanceof Error ? e.message : e); }
        try { const n = await timeoutReminderTask.execute({ limit: 100 }); if (n.created > 0) console.log(`[worker] 客服超时提醒 ${n.created} 条`); }
        catch (e) { console.error('[worker] 客服超时提醒失败', e instanceof Error ? e.message : e); }
        try { const n = await deliveryDriveTask.execute({ limit: 100 }); if (n.processed > 0) console.log(`[worker] 通知投递驱动 ${n.processed} 条（sent ${n.sent} / skipped ${n.skipped} / failed ${n.failed}）`); }
        catch (e) { console.error('[worker] 通知投递驱动失败', e instanceof Error ? e.message : e); }
      }
      for (let i = 0; i < 20 && !stopping; i++) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally { await app.close(); }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Worker 启动失败');
  process.exitCode = 1;
});
