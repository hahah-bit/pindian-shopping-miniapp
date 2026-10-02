import{spawnSync}from'node:child_process';import{readFileSync}from'node:fs';import{parseEnv}from'node:util';
const action=process.argv[2]??'status';if(!['up','down','status'].includes(action))throw Error('仅支持up/down/status');
const e=parseEnv(readFileSync('.env.simulation','utf8'));if(e.APP_ENV!=='simulation'||e.POSTGRES_DB!=='pindian_simulation')throw Error('必须使用独立模拟环境');
const args=['compose','--env-file','.env.simulation','-p','pindian-simulation','-f','compose.yaml','-f','compose.simulation.yaml',...(action==='up'?['up','-d','--build','--wait','--wait-timeout','180']:action==='down'?['down']:['ps'])];
const r=spawnSync('docker',args,{stdio:'inherit'});process.exitCode=r.status??1;
