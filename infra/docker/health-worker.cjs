const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
try {
  const health = JSON.parse(readFileSync(join(process.env.WORKER_HEALTH_DIR || join(tmpdir(), 'pindian-worker'), 'health.json'), 'utf8'));
  const age = Date.now() - health.checkedAt;
  process.exitCode = health.ready === true && age >= 0 && age < 20000 ? 0 : 1;
} catch { process.exitCode = 1; }
