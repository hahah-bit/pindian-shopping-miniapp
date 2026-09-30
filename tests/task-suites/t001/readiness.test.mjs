import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CheckReadiness } = require('../../../backend/dist/platform/application/check-readiness/check-readiness.js');
const { DescribePlatform } = require('../../../backend/dist/platform/application/describe-platform/describe-platform.js');
const { readConfig } = require('../../../backend/dist/bootstrap/config.js');

test('就绪检查真实调用端口，依赖成功才就绪', async () => {
  let called = 0;
  const probe = new CheckReadiness({ async ping() { called++; } });
  assert.equal(await probe.execute(), true);
  assert.equal(called, 1);
});
test('依赖失败转为不可用，不将连接串向调用方泄露', async () => {
  const probe = new CheckReadiness({ async ping() { throw new Error('postgresql://user:secret@host/database'); } });
  assert.equal(await probe.execute(), false);
});
test('无效环境拒绝启动配置，错误不回显连接串', () => {
  assert.throws(() => readConfig({}), /必须设置/);
  assert.throws(() => readConfig({ DATABASE_URL: 'https://user:secret@example.com/db' }), (error) => !error.message.includes('secret') && error.message.includes('PostgreSQL'));
  assert.throws(() => readConfig({ DATABASE_URL: 'postgresql://host/db', PORT: '0' }), /PORT/);
  assert.throws(() => readConfig({ DATABASE_URL: 'postgresql://host/db', CORS_ORIGINS: '*' }), /CORS/);
});
test('公开元数据不允许调用方改写服务内的上下文描述', () => {
  const service = new DescribePlatform([{ key: 'catalog', name: '商品', description: '已规划', status: 'planned' }]);
  const first = service.execute();
  first.contexts[0].name = '修改';
  assert.equal(service.execute().contexts[0].name, '商品');
  assert.equal(service.execute().businessReady, false);
});
