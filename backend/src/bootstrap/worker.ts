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
import { PostgresGroupRepository, PostgresShareReservationRepository } from '../contexts/group-buying/adapters/outbound/postgres/group-repositories';
import { PostgresOrderRepository } from '../contexts/ordering/adapters/outbound/postgres/order-repository';
import { PostgresPaymentRepository } from '../contexts/payments/adapters/outbound/postgres/payment-repository';
import { PostgresRefundRepository } from '../contexts/payments/adapters/outbound/postgres/refund-repository';
import { getStockReservationPort } from '../contexts/catalog/adapters/outbound/catalog-stock-adapters';
import { Pool } from 'pg';
import { readConfig } from './config';

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
  const deadlineTask = new FailDeadlineGroupsTask(expiryDeps);
  // T006 支付任务（D010 单 Worker 循环五任务；状态全在 DB，重启自动恢复）
  const payments = new PostgresPaymentRepository(pool);
  const refunds = new PostgresRefundRepository(pool);
  const payChannel = app.get<import('../contexts/payments/application/ports').PaymentChannelPort>('PAY_CHANNEL_PORT');
  const refundCreator = new CreateFullRefundUseCase({ refunds, payments, clock: expiryDeps.clock });
  const confirm = new ConfirmPaymentWorkflow({
    groups: expiryDeps.groups,
    reservations: expiryDeps.reservations,
    orders: expiryDeps.orders,
    payments,
    refunds: { createFullRefund: (input) => refundCreator.execute(input) },
    stocks: expiryDeps.stocks,
    runner: expiryDeps.runner,
    clock: expiryDeps.clock
  });
  const payQueryTask = new PaymentQueryCompensationTask({ payments, channel: payChannel, confirm, runner: expiryDeps.runner, clock: expiryDeps.clock });
  const refundDriveTask = new RefundDriveTask({ refunds, payments, channel: payChannel, runner: expiryDeps.runner, clock: expiryDeps.clock });
  const anomalyTask = new AnomalyStatsTask({
    countPendingReviewPayments: () => payments.countByStatus('pending_review'),
    countFailedRefunds: () => refunds.countFailedRefunds()
  });
  const healthDir = process.env.WORKER_HEALTH_DIR ?? join(tmpdir(), 'pindian-worker');
  await mkdir(healthDir, { recursive: true });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log('[worker] 业务任务循环启动：预占过期 / 组截止 / 支付查询补偿 / 退款驱动 / 异常统计');
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
        try { const n = await payQueryTask.execute({ limit: 100 }); if (n > 0) console.log(`[worker] 支付查询补偿确认 ${n} 笔`); }
        catch (e) { console.error('[worker] 支付查询补偿失败', e instanceof Error ? e.message : e); }
        try { const n = await refundDriveTask.execute({ limit: 100 }); if (n > 0) console.log(`[worker] 退款驱动处理 ${n} 笔`); }
        catch (e) { console.error('[worker] 退款驱动失败', e instanceof Error ? e.message : e); }
        try {
          const stats = await anomalyTask.execute();
          if (stats.pendingReviewPayments > 0 || stats.failedRefunds > 0) console.log(`[worker] 异常待人工：待复核支付 ${stats.pendingReviewPayments} 笔，失败退款 ${stats.failedRefunds} 笔`);
        }
        catch (e) { console.error('[worker] 异常统计失败', e instanceof Error ? e.message : e); }
      }
      for (let i = 0; i < 20 && !stopping; i++) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally { await app.close(); }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Worker 启动失败');
  process.exitCode = 1;
});
