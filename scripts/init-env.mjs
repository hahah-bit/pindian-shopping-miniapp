import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env 已存在，保留现有配置。');
} else {
  const password = randomBytes(24).toString('hex');
  const example = readFileSync('.env.example', 'utf8');
  writeFileSync('.env', example.replaceAll('replace-with-random-local-password', password), { flag: 'wx' });
  console.log('已生成本地 .env 和随机数据库密码；凭据不输出到日志。');
}
