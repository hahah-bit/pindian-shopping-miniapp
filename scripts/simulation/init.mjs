import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir=resolve('data/simulation/keys'); mkdirSync(dir,{recursive:true});
for(const name of ['merchant','platform']) if(!existsSync(`${dir}/${name}.pem`)) {
 const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 writeFileSync(`${dir}/${name}.pem`,pair.privateKey,{mode:0o600}); writeFileSync(`${dir}/${name}-public.pem`,pair.publicKey);
}
if(!existsSync('.env.simulation')) {
 const password=randomBytes(24).toString('hex');
 const e={APP_ENV:'simulation',POSTGRES_USER:'pindian',POSTGRES_PASSWORD:password,POSTGRES_DB:'pindian_simulation',POSTGRES_PORT:'5534',API_PORT:'3300',ADMIN_PORT:'8380',DATABASE_URL:`postgresql://pindian:${password}@127.0.0.1:5534/pindian_simulation`,PUBLIC_API_BASE_URL:'http://127.0.0.1:3300',CORS_ORIGINS:'http://127.0.0.1:8380',WX_APPID:'simulation-appid',WX_APP_SECRET:'simulation-secret',WX_API_BASE_URL:'http://simulator:3999',WX_PAY_MCHID:'simulation-mchid',WX_PAY_APIV3_KEY:randomBytes(16).toString('hex'),WX_PAY_SERIAL_NO:'simulation-merchant',WX_PAY_PRIVATE_KEY_PATH:'/run/wechat/merchant.pem',WX_PAY_PLATFORM_PUBLIC_KEY_PATH:'/run/wechat/platform-public.pem',WX_PAY_NOTIFY_URL:'http://api:3000/api/payments/v1/notify',WX_PAY_ENDPOINT_BASE:'http://simulator:3999',SIMULATION_CONTROL_TOKEN:randomBytes(24).toString('hex')};
 writeFileSync('.env.simulation',Object.entries(e).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
}
console.log('本地模拟配置和测试密钥已准备；保留已有配置，不输出凭据。');
