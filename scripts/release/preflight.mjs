import{readConfig}from'../../backend/dist/bootstrap/config.js';import{validateReleaseEnvironment}from'./guards.mjs';
try{validateReleaseEnvironment(process.env);readConfig(process.env);console.log('生产配置预检通过（未验证真实微信渠道）');}catch{console.error('生产配置预检失败：检查 APP_ENV、固定镜像版本、公网HTTPS、微信配置和可读密钥；不输出配置值');process.exitCode=1;}
