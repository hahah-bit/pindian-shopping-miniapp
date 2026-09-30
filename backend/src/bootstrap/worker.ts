import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundationModule } from './foundation.module';
import { CheckReadiness } from '../platform/application/check-readiness/check-readiness';
import { ExpireReservationsTask, FailDeadlineGroupsTask } from '../workflows/order-expiry.tasks';
import { PostgresGroupRepository, PostgresShareReservationRepository } from '../contexts/group-buying/adapters/outbound/postgres/group-repositories';
import { PostgresOrderRepository } from '../contexts/ordering/adapters/outbound/postgres/order-repository';
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
  const healthDir = process.env.WORKER_HEALTH_DIR ?? join(tmpdir(), 'pindian-worker');
  await mkdir(healthDir, { recursive: true });
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log('[worker] 框架入口已启动；尚未接入业务任务');
  try {
    while (!stopping) {
      const ready = await readiness.execute();
      await writeFile(join(healthDir, 'health.json'), JSON.stringify({ ready, checkedAt: Date.now(), businessTasksEnabled: false }));
      if (!ready) console.error('[worker] 数据库依赖不可用');
      else {
        try { const n = await expireTask.execute({ limit: 200 }); if (n > 0) console.log(`[worker] 预占过期处理 ${n} 笔`); }
        catch (e) { console.error('[worker] 预占过期任务失败', e instanceof Error ? e.message : e); }
        try { const n = await deadlineTask.execute({ limit: 200 }); if (n > 0) console.log(`[worker] 组截止处理 ${n} 组`); }
        catch (e) { console.error('[worker] 组截止任务失败', e instanceof Error ? e.message : e); }
      }
      for (let i = 0; i < 20 && !stopping; i++) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally { await app.close(); }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Worker 启动失败');
  process.exitCode = 1;
});
