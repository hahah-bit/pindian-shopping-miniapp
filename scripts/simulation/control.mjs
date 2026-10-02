import{readFileSync}from'node:fs';import{parseEnv}from'node:util';
const env=parseEnv(readFileSync('.env.simulation','utf8'));
const body=JSON.parse(process.argv[2]??'{}');
const r=await fetch('http://127.0.0.1:3399/simulation/control',{method:'POST',headers:{Authorization:`Bearer ${env.SIMULATION_CONTROL_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
if(!r.ok)throw Error(`模拟控制失败HTTP ${r.status}`);console.log(JSON.stringify(await r.json()));
