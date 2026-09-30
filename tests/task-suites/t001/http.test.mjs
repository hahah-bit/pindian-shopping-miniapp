import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('真实 HTTP：存活、数据库不可达、契约、错误及请求 ID', { timeout: 30000 }, async (context) => {
  const port = await unusedPort();
  const unavailableDbPort = await unusedPort();
  const child = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    env: { ...process.env, PORT: String(port), DATABASE_URL: `postgresql://test:not-a-real-password@127.0.0.1:${unavailableDbPort}/missing`, CORS_ORIGINS: 'http://localhost:5173' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; });
  child.stderr.on('data', (data) => { logs += data; });
  context.after(async () => {
    if (child.exitCode !== null) return;
    child.kill();
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
  });
  const base = `http://127.0.0.1:${port}`;
  let started = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`后端提前退出：${logs}`);
    try { if ((await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(500) })).ok) { started = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(started, `后端应启动：${logs}`);
  const live = await fetch(`${base}/api/health/live`, { headers: { 'X-Request-Id': 't001-smoke' } });
  const liveBody = await live.json();
  assert.equal(liveBody.data.status, 'live');
  assert.equal(liveBody.requestId, 't001-smoke');
  assert.equal(live.headers.get('x-request-id'), 't001-smoke');
  const ready = await fetch(`${base}/api/health/ready`);
  assert.equal(ready.status, 503);
  const error = await ready.json();
  assert.equal(error.code, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(error.requestId, ready.headers.get('x-request-id'));
  assert.ok(!JSON.stringify(error).includes('not-a-real-password'));
  for (const endpoint of ['mini', 'admin']) {
    const response = await fetch(`${base}/api/${endpoint}/v1/platform`);
    assert.equal(response.status, 200);
    const info = (await response.json()).data;
    assert.equal(info.businessReady, false);
    assert.equal(info.contexts.length, 12);
    // T002 起 catalog/identity-access/inventory/audit 已部分实现（partial）；其余仍为 planned。
    assert.ok(info.contexts.every((item) => item.status === 'planned' || item.status === 'partial'));
    const partial = info.contexts.filter((item) => item.status === 'partial').map((item) => item.key).sort();
    assert.deepEqual(partial, ['audit', 'catalog', 'identity-access', 'inventory']);
  }
  const openapi = await fetch(`${base}/api/health/openapi`);
  assert.equal(openapi.status, 200);
  assert.match(await openapi.text(), /openapi: 3\.0\.3/);
  const missing = await fetch(`${base}/api/not-found`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'NOT_FOUND');
  const invalidId = await fetch(`${base}/api/health/live`, { headers: { 'X-Request-Id': 'invalid id' } });
  assert.notEqual((await invalidId.json()).requestId, 'invalid id');
  const cors = await fetch(`${base}/api/health/live`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(cors.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
