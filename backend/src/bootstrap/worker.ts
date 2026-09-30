import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoundationModule } from './foundation.module';
import { CheckReadiness } from '../platform/application/check-readiness/check-readiness';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(FoundationModule);
  const readiness = app.get(CheckReadiness);
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
      for (let i = 0; i < 20 && !stopping; i++) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally { await app.close(); }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Worker 启动失败');
  process.exitCode = 1;
});
