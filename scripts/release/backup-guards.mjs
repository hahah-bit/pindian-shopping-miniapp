export function validateRestoreTarget(source,target){
 if(target===source||!/^pindian-rehearsal-restore-[a-z0-9][a-z0-9-]{1,35}$/.test(target))throw Error('恢复只允许新的隔离目标，禁止覆盖源');return target;
}
export function validateBackupManifest(m){
 if(m?.version!==1||typeof m.sourceProject!=='string'||!m.files||!['database.dump,media.tar','database.dump,media.tar,simulator.tar'].includes(Object.keys(m.files).sort().join(','))||Object.values(m.files).some(v=>! /^[a-f0-9]{64}$/.test(v))||!Array.isArray(m.migrations)||!m.facts||typeof m.mediaFiles!=='string')throw Error('备份清单非法');return m;
}
