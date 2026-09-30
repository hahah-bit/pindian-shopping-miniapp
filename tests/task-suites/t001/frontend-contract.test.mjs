import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

test('后台客户端拒绝 HTTP 失败和不符合契约的数据，不静默切换 Mock', async () => {
  // Node 24 仅用于执行纯 TypeScript 客户端；生产仍由 Vite 构建。
  const { getPlatform } = await import('../../../apps/admin-web/src/platform/api-client.ts');
  await assert.rejects(getPlatform(async () => new Response('{}', { status: 503 })), /503/);
  await assert.rejects(getPlatform(async () => Response.json({ data: { stage: 'production' } })), /契约/);
  const expected = { stage: 'foundation', contexts: [], businessReady: false };
  assert.deepEqual(await getPlatform(async () => Response.json({ data: expected })), expected);
});
test('原生小程序注册页面和 Tab 页面真实存在，类型检查另行执行', async () => {
  const root = resolve(fileURLToPath(new URL('../../../apps/mini-program/miniprogram/', import.meta.url)));
  const app = JSON.parse(await readFile(resolve(root, 'app.json'), 'utf8'));
  assert.equal(new Set(app.pages).size, app.pages.length);
  for (const page of app.pages) {
    assert.ok(page.startsWith('features/'));
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) await access(resolve(root, `${page}.${extension}`));
  }
  for (const item of app.tabBar.list) assert.ok(app.pages.includes(item.pagePath));
});
test('源码依赖方向检查可执行并通过', () => {
  execFileSync(process.execPath, ['scripts/check-architecture.mjs'], { stdio: 'pipe' });
});
