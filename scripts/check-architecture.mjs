import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function* sources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(ts|vue)$/.test(entry.name)) yield path;
  }
}

const violations = [];
for (const base of ['backend/src', 'contracts/src', 'apps/admin-web/src', 'apps/mini-program/miniprogram']) {
  for await (const path of sources(resolve(root, base))) {
    const name = relative(root, path).replaceAll('\\', '/');
    const content = await readFile(path, 'utf8');
    const imports = [...content.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s*)['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const dependency of imports) {
      if (name.startsWith('backend/src/') && /\/(domain|application)\//.test(name)) {
        if (/^(@nestjs\/|pg$|typeorm$|@prisma\/)/.test(dependency) || /(^|\/)adapters(\/|$)/.test(dependency)) violations.push(`${name} 反向依赖 ${dependency}`);
      }
      if (!name.startsWith('backend/') && /(^|\/)backend(\/|$)|@pindian\/backend/.test(dependency)) violations.push(`${name} 导入后端内部实现 ${dependency}`);
    }
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log('架构边界检查通过（源码导入检查；不替代设计审查）。');
