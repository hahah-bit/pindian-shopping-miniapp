import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../../application/ports';

const scrypt = promisify(scryptCallback) as (password: string | Buffer, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const FORMAT = 'scrypt';

/** scrypt 口令哈希；格式 scrypt$N$r$p$saltBase64$hashBase64，校验用 timingSafeEqual。 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
    return [FORMAT, N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== FORMAT) return false;
    const nText = parts[1];
    const rText = parts[2];
    const pText = parts[3];
    const saltText = parts[4];
    const hashText = parts[5];
    if (!nText || !rText || !pText || !saltText || !hashText) return false;
    const n = Number(nText);
    const r = Number(rText);
    const p = Number(pText);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n < 1 || n > 1 << 22 || r < 1 || p < 1) return false;
    try {
      const salt = Buffer.from(saltText, 'base64');
      const expected = Buffer.from(hashText, 'base64');
      if (salt.length === 0 || expected.length === 0) return false;
      const derived = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }
}
