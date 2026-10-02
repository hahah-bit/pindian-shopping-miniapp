import{readFileSync,openSync,closeSync}from'node:fs';import{resolve,join}from'node:path';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';import{docker,stack}from'./docker.mjs';import{sha,facts,mediaFiles}from'./backup.mjs';import{validateRestoreTarget,validateBackupManifest}from'./backup-guards.mjs';
export function verifyBackup(directory){const dir=resolve(directory),m=validateBackupManifest(JSON.parse(readFileSync(join(dir,'manifest.json'),'utf8')));for(const[name,hash]of Object.entries(m.files))if(sha(join(dir,name))!==hash)throw Error('备份校验失败：'+name);return m;}
export function restore({project,envFile,directory,rehearsal=false}){
 const m=verifyBackup(directory);validateRestoreTarget(m.sourceProject,project);
 if(docker(['ps','-aq','--filter','label=com.docker.compose.project='+project]).trim()||docker(['volume','ls','-q','--filter','label=com.docker.compose.project='+project]).trim())throw Error('恢复目标已有容器或卷，禁止覆盖');
 if(Boolean(m.files['simulator.tar'])!==rehearsal)throw Error('备份渠道模式与目标不匹配');
 const s=stack(project,envFile,{rehearsal});s.run('up','-d','--wait','postgres');
 let fd=openSync(join(directory,'database.dump'),'r');try{docker([...s.args,'exec','-T','postgres','pg_restore','--exit-on-error','--no-owner','--no-acl','-U',s.env.POSTGRES_USER,'-d',s.env.POSTGRES_DB],{stdio:[fd,'pipe','pipe']});}finally{closeSync(fd);}
 // 目标是新媒体卷；备份来自本工具，文件摘要在任何修改前核对。
 fd=openSync(join(directory,'media.tar'),'r');try{docker([...s.args,'run','--rm','--no-deps','--entrypoint','tar','api','-C','/var/lib/pindian/media','-xf','-'],{stdio:[fd,'pipe','pipe']});}finally{closeSync(fd);}
 if(rehearsal){fd=openSync(join(directory,'simulator.tar'),'r');try{docker([...s.args,'run','--rm','--no-deps','--entrypoint','tar','simulator','-C','/state','-xf','-'],{stdio:[fd,'pipe','pipe']});}finally{closeSync(fd);}}
 assert.deepEqual(facts(s),m.facts,'恢复业务事实摘要不同');assert.equal(mediaFiles(s),m.mediaFiles,'恢复媒体文件摘要不同');
 const migrations=s.exec('postgres','psql','-U',s.env.POSTGRES_USER,'-d',s.env.POSTGRES_DB,'-At','-c','SELECT name FROM schema_migrations ORDER BY name').trim().split(/\r?\n/);assert.deepEqual(migrations,m.migrations);
 s.run('up','-d','--wait','--wait-timeout','180');return m;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[project,envFile,directory,mode]=process.argv.slice(2);try{restore({project,envFile,directory,rehearsal:mode==='rehearsal'});console.log('新隔离项目恢复成功：业务事实、迁移和媒体逐项一致，服务健康。');}catch(e){console.error(e.message);process.exitCode=1;}}
