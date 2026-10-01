import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function findTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findTests(path));
    else if (entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files.sort();
}
const taskDirs = { t001: 'tests/task-suites/t001', t002: 'tests/task-suites/t002', t003: 'tests/task-suites/t003', t006: 'tests/task-suites/t006' };
const directory = taskDirs[process.argv[2]] ?? 'tests';
const files = await findTests(resolve(directory));
if (!files.length) throw new Error('没有发现测试，不能视为测试通过');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
