import 'reflect-metadata';
import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** 迁移锁：全库唯一，防止 API/多进程并发迁移。 */
const MIGRATION_LOCK_KEY = 88002002002;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('必须设置 DATABASE_URL');
  const migrationsDir = resolve(__dirname, '../../migrations');
  let files: string[];
  try { files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort(); }
  catch { throw new Error(`迁移目录不存在：${migrationsDir}`); }
  if (!files.length) throw new Error('迁移目录为空');

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name varchar(255) PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.name));
    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(resolve(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] 已应用 ${file}`);
        count++;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error instanceof Error ? new Error(`迁移失败 ${file}：${error.message}`) : error;
      }
    }
    console.log(`[migrate] 完成，本次应用 ${count} 个，共 ${files.length} 个迁移文件`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '迁移执行失败');
  process.exitCode = 1;
});
