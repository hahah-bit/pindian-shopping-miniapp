import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {readConfig}=require('../../../backend/dist/bootstrap/config.js');
const base={DATABASE_URL:'postgresql://local:local@127.0.0.1/local'};
test('F041 默认本地环境兼容未配置微信',()=>{assert.equal(readConfig(base).appEnv,'local');});
test('F041 模拟环境显式启用且保留独立端点',()=>{assert.equal(readConfig({...base,APP_ENV:'simulation',WX_API_BASE_URL:'http://simulator:3999'}).wxApiBaseUrl,'http://simulator:3999');});
test('F041 生产拒绝模拟端点和不完整凭据',()=>{
 for(const extra of [{WX_API_BASE_URL:'http://127.0.0.1:3999'},{WX_PAY_ENDPOINT_BASE:'http://simulator:3999'},{}]) assert.throws(()=>readConfig({...base,APP_ENV:'production',...extra}),/生产/);
 assert.throws(()=>readConfig({...base,APP_ENV:'typo'}),/APP_ENV/);
});
test('F041 Compose API与Worker收到相同渠道配置且密钥只读',()=>{
 const r=spawnSync('docker',['compose','--env-file','.env.example','config','--format','json'],{encoding:'utf8'}); assert.equal(r.status,0,r.stderr);
 const c=JSON.parse(r.stdout);
 for(const key of ['APP_ENV','WX_APPID','WX_APP_SECRET','WX_PAY_PRIVATE_KEY_PATH','WX_PAY_ENDPOINT_BASE']) assert.equal(c.services.api.environment[key],c.services.worker.environment[key]);
 for(const service of ['api','worker']) assert.ok(c.services[service].volumes.some(v=>v.target==='/run/wechat'&&v.read_only));
 assert.ok(c.services.postgres.ports.every(p=>p.host_ip==='127.0.0.1'));
});
