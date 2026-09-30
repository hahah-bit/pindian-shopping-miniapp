import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { ApplicationError } from '../../../../../shared/kernel';
import type { ImageStorage } from '../../../application/ports';

const STORAGE_KEY_PATTERN = /^products\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * 本地文件存储适配器：文件落在 MEDIA_DIR（Docker 为命名卷）。
 * storageKey 由领域层生成并校验，适配器再次拒绝任何路径穿越。
 */
export class LocalImageStorage implements ImageStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathOf(key: string): string {
    if (!STORAGE_KEY_PATTERN.test(key)) {
      throw new ApplicationError('VALIDATION_FAILED', '存储标识不合法');
    }
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, data);
    await rename(temp, target);
  }

  async delete(key: string): Promise<void> {
    const target = this.pathOf(key);
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    const target = this.pathOf(key);
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) throw new ApplicationError('NOT_FOUND', '图片不存在');
    return { stream: createReadStream(target), size: info.size };
  }
}
