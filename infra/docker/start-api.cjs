const {spawnSync}=require('node:child_process');
try{require('../../backend/dist/bootstrap/config.js').readConfig();}catch{console.error('API配置预检失败');process.exit(1);}
const migration=spawnSync(process.execPath,['backend/dist/bootstrap/migrate.js'],{stdio:'inherit'});if(migration.status!==0)process.exit(migration.status||1);
require('../../backend/dist/bootstrap/main.js');
