import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { ImageInspector } = require('../../../backend/dist/contexts/catalog/application/image-inspector.js');
const { UploadMediaAsset } = require('../../../backend/dist/contexts/catalog/application/upload-media-asset.js');
const { ListMediaAssets } = require('../../../backend/dist/contexts/catalog/application/list-media-assets.js');
const { DeleteMediaAsset } = require('../../../backend/dist/contexts/catalog/application/delete-media-asset.js');
const { MediaAsset } = require('../../../backend/dist/contexts/catalog/domain/index.js');

// ---------- 测试用 PNG 构造（仅头部有效即可被 image-size 解析尺寸） ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 2; // 真彩色
  const raw = Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01]); // 任意可 inflate 的最小数据，尺寸解析不需要完整图像
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 假件 ----------

class FakeStorage {
  constructor() { this.files = new Map(); this.failPut = false; this.failDelete = false; }
  async put(key, data) { if (this.failPut) throw new Error('disk full'); this.files.set(key, Buffer.from(data)); }
  async delete(key) { if (this.failDelete) throw new Error('busy'); this.files.delete(key); }
  async open(key) { return { stream: null, size: this.files.get(key)?.length ?? 0 }; }
}

class FakeMediaRepository {
  constructor() {
    this.assets = new Map();
    this.failInsert = false;
    this.references = new Map(); // mediaId -> count
  }
  async insert(asset) { if (this.failInsert) throw new Error('db down'); this.assets.set(asset.state.mediaId, asset); }
  async findById(id) { return this.assets.get(id) ?? null; }
  async findManyReady(ids) {
    return ids.map((id) => this.assets.get(id)).filter((a) => a && a.state.status === 'ready');
  }
  async listReady(page, pageSize) {
    const ready = [...this.assets.values()].filter((a) => a.state.status === 'ready')
      .sort((a, b) => b.state.createdAt - a.state.createdAt);
    return {
      items: ready.slice((page - 1) * pageSize, page * pageSize),
      total: ready.length,
      referenceCounts: new Map([...this.references].filter(([id]) => this.assets.get(id)?.state.status === 'ready'))
    };
  }
  async countReferences(id) { return this.references.get(id) ?? 0; }
  async markDeleted(id, at) {
    const asset = this.assets.get(id);
    if (!asset || asset.state.status !== 'ready') return false;
    this.assets.set(id, asset.markDeleted(at));
    return true;
  }
}

class FakeUrlBuilder {
  build(mediaId) { return `http://media.test/api/media/v1/assets/${mediaId}`; }
}

function buildUpload(overrides = {}) {
  const storage = new FakeStorage();
  const repository = new FakeMediaRepository();
  let tick = 0;
  const clock = { now: () => new Date(Date.parse('2026-09-30T00:00:00Z') + tick++ * 1000) };
  const upload = new UploadMediaAsset({
    storage,
    repository,
    urlBuilder: new FakeUrlBuilder(),
    inspector: new ImageInspector(),
    clock,
    ...overrides
  });
  return { storage, repository, upload, clock };
}

async function expectRejection(factory, code) {
  try { await factory(); }
  catch (error) {
    assert.equal(error.code, code, `期望 ${code} 实际 ${error.code}：${error.message}`);
    return error;
  }
  assert.fail(`应抛出 ${code}，但调用成功了`);
}

// ---------- 用例 ----------

test('图片检查：合法 PNG 识别尺寸；魔数伪装拒绝；损坏数据拒绝；超界尺寸拒绝', async () => {
  const inspector = new ImageInspector();
  const png = inspector.inspect(makePng(800, 600));
  assert.equal(png.format, 'png');
  assert.equal(png.width, 800);
  assert.equal(png.height, 600);

  const htmlErr = await expectRejection(() => inspector.inspect(Buffer.from('<html>not an image</html>')), 'UNSUPPORTED_MEDIA_TYPE');
  assert.match(htmlErr.message, /JPEG、PNG、WebP/);

  const truncated = makePng(800, 600).subarray(0, 12);
  await expectRejection(() => inspector.inspect(truncated), 'UNSUPPORTED_MEDIA_TYPE');

  await expectRejection(() => inspector.inspect(makePng(32, 32)), 'VALIDATION_FAILED');

  const wideErr = await expectRejection(() => inspector.inspect(makePng(6001, 100)), 'VALIDATION_FAILED');
  assert.match(wideErr.message, /6001/);

  const webpMagic = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
  const webpErr = await expectRejection(() => inspector.inspect(webpMagic), 'UNSUPPORTED_MEDIA_TYPE');
  assert.match(webpErr.message, /无法解码/, 'WebP 魔数被识别但数据不完整应报解码失败');
});

test('上传：合法图片写入存储并落库 ready，返回可访问 URL，路径由服务端生成', async () => {
  const { storage, repository, upload } = buildUpload();
  const result = await upload.execute({ buffer: makePng(640, 480), uploadedBy: 'admin-1' });
  assert.equal(result.format, 'png');
  assert.equal(result.width, 640);
  assert.match(result.url, /http:\/\/media\.test\/api\/media\/v1\/assets\//);
  assert.match(result.storageKey, /^products\/\d{4}\/[0-9a-f-]{36}\.png$/);
  assert.ok(storage.files.has(result.storageKey), '文件已写入');
  const stored = await repository.findById(result.id);
  assert.equal(stored.state.status, 'ready');
  assert.equal(stored.state.uploadedBy, 'admin-1');
  assert.equal(stored.state.sha256.length, 64);
});

test('上传：非法/超限/空内容不留任何文件与记录', async () => {
  const { storage, repository, upload } = buildUpload();
  await expectRejection(() => upload.execute({ buffer: Buffer.from('hello'), uploadedBy: 'a' }), 'UNSUPPORTED_MEDIA_TYPE');
  await expectRejection(() => upload.execute({ buffer: Buffer.alloc(0), uploadedBy: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => upload.execute({ buffer: makePng(10, 10), uploadedBy: 'a' }), 'VALIDATION_FAILED');
  assert.equal(storage.files.size, 0);
  assert.equal(repository.assets.size, 0);
});

test('上传补偿：落库失败时删除已写文件，不返回可引用资源', async () => {
  const { storage, repository, upload } = buildUpload();
  repository.failInsert = true;
  await expectRejection(() => upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' }), 'MEDIA_SAVE_FAILED');
  assert.equal(storage.files.size, 0, '补偿删除已写文件');
  assert.equal(repository.assets.size, 0);
});

test('上传：存储写入失败返回依赖不可用，无记录', async () => {
  const { storage, repository, upload } = buildUpload();
  storage.failPut = true;
  await expectRejection(() => upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' }), 'STORAGE_UNAVAILABLE');
  assert.equal(repository.assets.size, 0);
});

test('图片库：分页倒序列出 ready 资源并带引用计数；已删除不出现', async () => {
  const { repository, upload } = buildUpload();
  const first = await upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' });
  const second = await upload.execute({ buffer: makePng(320, 240), uploadedBy: 'a' });
  repository.references.set(first.id, 2);
  const list = new ListMediaAssets({ repository, urlBuilder: new FakeUrlBuilder() });
  const page = await list.execute({ page: 1, pageSize: 10 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].id, second.id, '按创建时间倒序');
  const withCount = page.items.find((item) => item.id === first.id);
  assert.equal(withCount.referencedByProducts, 2);

  const del = new DeleteMediaAsset({ repository, storage: new FakeStorage(), clock: { now: () => new Date() } });
  await del.execute({ mediaId: second.id });
  const after = await list.execute({ page: 1, pageSize: 10 });
  assert.equal(after.items.length, 1);
});

test('删除：被引用拒绝 MEDIA_IN_USE；未引用删除成功并移除文件；文件删除失败仍标记删除', async () => {
  const { storage, repository, upload } = buildUpload();
  const asset = await upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' });
  const del = new DeleteMediaAsset({ repository, storage, clock: { now: () => new Date() } });
  repository.references.set(asset.id, 1);
  await expectRejection(() => del.execute({ mediaId: asset.id }), 'MEDIA_IN_USE');
  assert.ok(storage.files.has(asset.storageKey), '被引用资源文件保留');

  repository.references.set(asset.id, 0);
  const result = await del.execute({ mediaId: asset.id });
  assert.deepEqual(result, { deleted: true });
  assert.ok(!storage.files.has(asset.storageKey), '未引用资源文件删除');
  assert.equal((await repository.findById(asset.id)).state.status, 'deleted');

  const another = await upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' });
  storage.failDelete = true;
  const tolerant = await del.execute({ mediaId: another.id });
  assert.deepEqual(tolerant, { deleted: true }, '文件删除失败不影响删除结果（孤儿文件人工清理）');
});

test('删除：不存在或已删除返回 NOT_FOUND', async () => {
  const { repository, upload } = buildUpload();
  const del = new DeleteMediaAsset({ repository, storage: new FakeStorage(), clock: { now: () => new Date() } });
  await expectRejection(() => del.execute({ mediaId: '00000000-0000-4000-8000-000000000000' }), 'NOT_FOUND');
  const asset = await upload.execute({ buffer: makePng(640, 480), uploadedBy: 'a' });
  await del.execute({ mediaId: asset.id });
  await expectRejection(() => del.execute({ mediaId: asset.id }), 'NOT_FOUND');
});
