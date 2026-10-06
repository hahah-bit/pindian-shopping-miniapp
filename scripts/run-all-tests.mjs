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
const taskDirs = Object.fromEntries(['t001','t002','t003','t004','t006','t007','t008','t009','t010','t011','t012','t013','t014'].map(task=>[task,`tests/task-suites/${task}`]));
if (process.argv[2] && !taskDirs[process.argv[2]]) throw new Error('未知专项任务，禁止回退为全量测试');
const directory = taskDirs[process.argv[2]] ?? 'tests';
const files = await findTests(resolve(directory));
if(process.argv[2]==='t014')files.push(...['ai-support-http.test.mjs','ai-support.test.mjs'].map(name=>resolve('tests/task-suites/t013',name)));
if (!files.length) throw new Error('没有发现测试，不能视为测试通过');
const child = spawn(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
