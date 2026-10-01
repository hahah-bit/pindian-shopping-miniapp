import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WxPayNotifyVerifier } = require('../../../backend/dist/contexts/payments/adapters/outbound/wechat/wx-pay-notify-verifier.js');

const APIV3 = 'test-api-v3-key-32bytes-12345678';
const ORDER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

// 构造一个真实可解密的回调密文（AES-256-GCM，tag 后置 16 字节）
function makeCiphertext(plain, nonce, key) {
  const { createCipheriv, randomBytes } = require('node:crypto');
  const iv = Buffer.from(nonce, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return Buffer.concat([data, cipher.getAuthTag()]).toString('base64');
}



const verifier = new WxPayNotifyVerifier({ configured: true, apiV3Key: APIV3, mchid: '1900000001' });

test('回调解密：合法密文解出支付事实；mchid 不匹配拒绝', () => {
  const plain = JSON.stringify({
    mchid: '1900000001', out_trade_no: ORDER_ID, transaction_id: 'wx-tx-1',
    trade_state: 'SUCCESS', amount: { total: 16833, payer_total: 16833 }, payer: { openid: 'o-1' }
  });
  const nonce = 'abc12345';
  const ciphertext = makeCiphertext(plain, nonce, APIV3);
  const body = JSON.stringify({
    id: 'evt-1', event_type: 'TRANSACTION.SUCCESS', resource_type: 'encrypt-resource',
    resource: { original_type: 'transaction', algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce }
  });
  const result = verifier.verify(body, { 'wechatpay-serial': 'SERIAL', 'wechatpay-signature': 'sig', 'wechatpay-timestamp': '1', 'wechatpay-nonce': 'n' });
  assert.equal(result.valid, true);
  assert.equal(result.decrypted?.outTradeNo, ORDER_ID);
  assert.equal(result.decrypted?.payerTotal, 16833);
});

test('回调解密：密文被篡改 / 非法 JSON / 缺 resource 均拒绝', () => {
  const nonce = 'abc12345';
  const tampered = makeCiphertext('{"mchid":"x"}', nonce, APIV3);
  const bad = tampered.slice(0, -4) + 'AAAA';
  assert.equal(verifier.verify(JSON.stringify({ resource: { ciphertext: bad, nonce } }), {}).valid, false);
  assert.equal(verifier.verify('not-json', {}).valid, false);
  assert.equal(verifier.verify('{}', {}).valid, false);
});

