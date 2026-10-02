import test from'node:test';import assert from'node:assert/strict';import{validateRestoreTarget,validateBackupManifest}from'../../../scripts/release/backup-guards.mjs';
test('F047 禁止同源、非隔离目标与清单路径穿越',()=>{
 assert.throws(()=>validateRestoreTarget('pindian-main','pindian-main'),/隔离/);
 assert.throws(()=>validateRestoreTarget('pindian-source','pindian-production'),/隔离/);
 assert.equal(validateRestoreTarget('pindian-source','pindian-rehearsal-restore-test'),'pindian-rehearsal-restore-test');
 assert.throws(()=>validateBackupManifest({version:1,files:{'../database.dump':'abc'}}),/清单/);
});

import{mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';import{verifyBackup}from'../../../scripts/release/restore.mjs';
test('F047 备份损坏在Docker创建目标前被拒绝',t=>{const dir=mkdtempSync(join(tmpdir(),'pindian-backup-check-'));t.after(()=>rmSync(dir,{recursive:true}));const files={};for(const name of ['database.dump','media.tar']){writeFileSync(join(dir,name),name);files[name]=createHash('sha256').update(name).digest('hex');}writeFileSync(join(dir,'manifest.json'),JSON.stringify({version:1,sourceProject:'pindian-rehearsal-source',files,facts:{},migrations:[],mediaFiles:''}));assert.equal(verifyBackup(dir).version,1);writeFileSync(join(dir,'database.dump'),'tamper');assert.throws(()=>verifyBackup(dir),/校验失败/);});

test('F047 模拟渠道状态允许独立备份并受摘要约束',()=>{const hash='a'.repeat(64);assert.equal(validateBackupManifest({version:1,sourceProject:'pindian-rehearsal-source',files:{'database.dump':hash,'media.tar':hash,'simulator.tar':hash},migrations:[],facts:{},mediaFiles:''}).version,1);});
