import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { WxPayNotifyVerifier } = require('../../../backend/dist/contexts/payments/adapters/outbound/wechat/wx-pay-notify-verifier.js');

const APIV3 = 'test-api-v3-key-32bytes-12345678';
const ORDER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const MCHID = '1900000001';

// 平台密钥对（微信支付公钥模式：商户配置平台公钥，微信用平台私钥签名回调）
const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyDir = mkdtempSync(join(tmpdir(), 'wxnotify-'));
const platformPubPath = join(keyDir, 'platform_pub.pem');
writeFileSync(platformPubPath, platform.publicKey.export({ type: 'spki', format: 'pem' }));

function makeCiphertext(plain, nonce, key = APIV3, aad = 'transaction') {
  const iv = Buffer.from(nonce, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return Buffer.concat([data, cipher.getAuthTag()]).toString('base64');
}

function rsaSign(privateKey, message) {
  return createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

function makeBody(plain, opts = {}) {
  const nonce = opts.nonce ?? 'n-1234567890';
  const ciphertext = makeCiphertext(plain, nonce, opts.apiV3Key ?? APIV3, opts.aad ?? 'transaction');
  return JSON.stringify({
    id: 'evt-1',
    event_type: opts.eventType ?? 'TRANSACTION.SUCCESS',
    resource_type: 'encrypt-resource',
    resource: { original_type: opts.originalType ?? 'transaction', algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce, associated_data: opts.aad ?? 'transaction' }
  }, null, opts.pretty ? 2 : undefined);
}

function makeVerifier() {
  return new WxPayNotifyVerifier({ configured: true, apiV3Key: APIV3, mchid: MCHID, platformPublicKeyPath: platformPubPath });
}

/** 用平台私钥对 rawBody 生成完整回调头。 */
function signHeaders(rawBody, privateKey = platform.privateKey, overrides = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(8).toString('hex');
  return {
    'wechatpay-serial': 'PUB_KEY_ID_TEST',
    'wechatpay-signature': rsaSign(privateKey, `${timestamp}\n${nonce}\n${rawBody}\n`),
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    ...overrides
  };
}

const paymentPlain = JSON.stringify({
  mchid: MCHID, out_trade_no: ORDER_ID, transaction_id: 'wx-tx-1',
  trade_state: 'SUCCESS', amount: { total: 16833, payer_total: 16833 }, payer: { openid: 'o-1' }
});

test('合法回调：平台私钥签名 + APIv3 密文 → 解出支付事实（A01）', () => {
  const verifier = makeVerifier();
  const rawBody = makeBody(paymentPlain);
  const result = verifier.verify(rawBody, signHeaders(rawBody));
  assert.equal(result.valid, true);
  assert.equal(result.decrypted.eventType, 'TRANSACTION.SUCCESS');
  assert.equal(result.decrypted.outTradeNo, ORDER_ID);
  assert.equal(result.decrypted.channelTransactionId, 'wx-tx-1');
  assert.equal(result.decrypted.payerTotal, 16833);
});

test('生产强制验签：缺公钥/缺签名/错误签名/缺任一头 一律拒绝（A01）', () => {
  const rawBody = makeBody(paymentPlain);
  const goodHeaders = signHeaders(rawBody);

  // 未配置平台公钥 → 拒绝（即使密文合法）
  const noPub = new WxPayNotifyVerifier({ configured: true, apiV3Key: APIV3, mchid: MCHID, platformPublicKeyPath: null });
  assert.equal(noPub.verify(rawBody, goodHeaders).valid, false);

  // 缺全部签名头 → 拒绝
  assert.equal(makeVerifier().verify(rawBody, {}).valid, false);
  // 缺单个头（signature / serial / timestamp / nonce）→ 拒绝
  for (const key of ['wechatpay-signature', 'wechatpay-serial', 'wechatpay-timestamp', 'wechatpay-nonce']) {
    const broken = { ...goodHeaders };
    delete broken[key];
    assert.equal(makeVerifier().verify(rawBody, broken).valid, false, `缺 ${key} 应拒绝`);
  }
  // 错误私钥签名 → 拒绝
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(makeVerifier().verify(rawBody, signHeaders(rawBody, attacker.privateKey)).valid, false);
  // 签名与报文不匹配（对其他报文签名）→ 拒绝
  const otherBody = makeBody(paymentPlain, { eventType: 'TRANSACTION.SUCCESS' }) + ' ';
  assert.equal(makeVerifier().verify(rawBody, signHeaders(otherBody)).valid, false);
});

test('验签作用于原始报文：带空白/换行的报文体必须以原文验签（A01）', () => {
  // pretty 报文（含空白换行）——用该原文签名 → 通过
  const pretty = makeBody(paymentPlain, { pretty: true });
  assert.equal(makeVerifier().verify(pretty, signHeaders(pretty)).valid, true);
  // 同一签名对"压缩后"的报文 → 拒绝（证明不能重新序列化后验签）
  const compact = JSON.stringify(JSON.parse(pretty));
  assert.equal(makeVerifier().verify(compact, signHeaders(pretty)).valid, false);
});

test('时间戳超窗（>5 分钟）拒绝（防重放）', () => {
  const rawBody = makeBody(paymentPlain);
  const headers = signHeaders(rawBody);
  headers['wechatpay-timestamp'] = String(Math.floor(Date.now() / 1000) - 601);
  assert.equal(makeVerifier().verify(rawBody, headers).valid, false);
});

test('退款回调：REFUND.SUCCESS 解出 out_refund_no / refund_status（R6）', () => {
  const refundPlain = JSON.stringify({
    mchid: MCHID, out_refund_no: 'rf-20261001-0001', refund_id: 'wxr-1',
    refund_status: 'SUCCESS', amount: { refund: 16833 }
  });
  const verifier = makeVerifier();
  const rawBody = makeBody(refundPlain, { eventType: 'REFUND.SUCCESS', originalType: 'refund', aad: 'refund' });
  const result = verifier.verify(rawBody, signHeaders(rawBody));
  assert.equal(result.valid, true);
  assert.equal(result.decrypted.eventType, 'REFUND.SUCCESS');
  assert.equal(result.decrypted.outRefundNo, 'rf-20261001-0001');
  assert.equal(result.decrypted.refundStatus, 'SUCCESS');
  assert.equal(result.decrypted.channelRefundId, 'wxr-1');
});

test('mchid 不匹配 / 密文篡改 / 非法 JSON 拒绝', () => {
  const verifier = makeVerifier();
  const wrongMch = makeBody(JSON.stringify({ mchid: 'other', out_trade_no: ORDER_ID, transaction_id: 't', trade_state: 'SUCCESS', amount: { payer_total: 1 } }));
  assert.equal(verifier.verify(wrongMch, signHeaders(wrongMch)).valid, false);

  const nonce = 'abc12345';
  const tampered = makeCiphertext('{"mchid":"x"}', nonce);
  const badBody = JSON.stringify({ id: 'e', event_type: 'TRANSACTION.SUCCESS', resource: { ciphertext: tampered.slice(0, -4) + 'AAAA', nonce, associated_data: 'transaction' } });
  assert.equal(verifier.verify(badBody, signHeaders(badBody)).valid, false);

  const notJson = 'not-json';
  assert.equal(verifier.verify(notJson, signHeaders(notJson)).valid, false);
});
