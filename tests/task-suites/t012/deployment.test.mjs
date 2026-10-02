import test from 'node:test';import assert from 'node:assert/strict';import{validateReleaseEnvironment}from'../../../scripts/release/guards.mjs';
test('F046 生产必须完整版本与配置；模拟端点拒绝',()=>{
 assert.throws(()=>validateReleaseEnvironment({APP_ENV:'simulation'}),/production/);
 assert.throws(()=>validateReleaseEnvironment({APP_ENV:'production',WX_API_BASE_URL:'http://fake'}),/模拟/);
 assert.throws(()=>validateReleaseEnvironment({APP_ENV:'production'}),/版本/);
});

import{spawnSync}from'node:child_process';
test('F046 生产拓扑只有HTTPS入口，密钥只读，先预检后迁移',()=>{
 const r=spawnSync('docker',['compose','--env-file','.env.production.example','-f','compose.production.yaml','config','--format','json'],{encoding:'utf8',env:{...process.env,POSTGRES_PASSWORD:'test-only',RELEASE_IMAGE:'pindian-api:abcdef123456',ADMIN_RELEASE_IMAGE:'pindian-admin:abcdef123456',WX_APPID:'test-app',WX_APP_SECRET:'test-secret',WX_PAY_MCHID:'test-mch',WX_PAY_APIV3_KEY:'12345678901234567890123456789012',WX_PAY_SERIAL_NO:'test-serial'}});assert.equal(r.status,0,r.stderr);const c=JSON.parse(r.stdout);
 for(const name of ['postgres','api','worker','admin'])assert.ok(!c.services[name].ports?.length,name+'不能公开端口');assert.equal(c.services.gateway.ports[0].target,443);for(const name of ['api','worker'])assert.ok(c.services[name].volumes.some(v=>v.target==='/run/wechat'&&v.read_only));assert.equal(c.services.api.environment.APP_ENV,'production');
 const invalid=spawnSync(process.execPath,['infra/docker/start-api.cjs'],{encoding:'utf8',env:{...process.env,APP_ENV:'production',DATABASE_URL:'postgresql://test:test@127.0.0.1:1/test',WX_API_BASE_URL:'http://simulation'}});assert.equal(invalid.status,1);assert.match(invalid.stderr,/配置预检失败/);assert.doesNotMatch(invalid.stdout,/migrate/);
});
