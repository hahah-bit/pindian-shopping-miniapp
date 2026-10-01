import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { FoundationModule } from './foundation.module';
import { HttpErrorFilter } from './http-error.filter';
import { readConfig } from './config';

async function main(): Promise<void> {
  const config = readConfig();
  const app = await NestFactory.create<NestExpressApplication>(FoundationModule, { rawBody: true });
  app.setGlobalPrefix('api');
  app.use((request: { headers: Record<string, unknown>; requestId: string }, response: { setHeader: (key: string, value: string) => void }, next: () => void) => {
    const supplied = request.headers['x-request-id'];
    request.requestId = typeof supplied === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    next();
  });
  if (config.corsOrigins.length) app.enableCors({ origin: config.corsOrigins, exposedHeaders: ['X-Request-Id'] });
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '后端启动失败');
  process.exitCode = 1;
});
