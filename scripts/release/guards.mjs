export function validateReleaseEnvironment(env){
 if(env.APP_ENV!=='production')throw Error('发布预检要求 APP_ENV=production');
 if(env.WX_API_BASE_URL||env.WX_PAY_ENDPOINT_BASE||env.SIMULATION_CONTROL_TOKEN)throw Error('生产禁止模拟渠道');
 for(const key of ['RELEASE_IMAGE','ADMIN_RELEASE_IMAGE'])if(!env[key]||env[key].endsWith(':latest')||(!env[key].includes('@sha256:')&&!/:[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(env[key])))throw Error('发布镜像必须指定固定版本');
 return env;
}
