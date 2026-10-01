import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createVerify, createCipheriv } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpWxPayAdapter } from '../../../backend/dist/contexts/payments/adapters/outbound/wechat/wx-pay.adapter.js';

const MCHID = '1900000001';
const APPID = 'wx-test-appid';
const SERIAL = 'TESTSERIAL0001';
const APIV3 = 'test-api-v3-key-32bytes-12345678';

function makeKeys() {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'wxpay-test-'));
  const merchantKeyPath = join(dir, 'apiclient_key.pem');
  writeFileSync(merchantKeyPath, merchant.privateKey.export({ type: 'pkcs1', format: 'pem' }));
  const platformPubPath = join(dir, 'platform_pub.pem');
  writeFileSync(platformPubPath, platform.publicKey.export({ type: 'spki', format: 'pem' }));
  return {
    merchantPrivateKey: merchant.privateKey,
    merchantPublicKey: merchant.publicKey,
    platformPrivateKey: platform.privateKey,
    platformPublicKey: platform.publicKey,
    merchantKeyPath,
    platformPubPath
  };
}

function rsaSign(privateKey, message) {
  return createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

function rsaVerify(publicKey, message, signatureB64) {
  return createVerify('RSA-SHA256').update(message).verify(publicKey, signatureB64, 'base64');
}

function startFakeWx(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const record = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(record);
      const out = handler(record) ?? { status: 200, body: {} };
      res.writeHead(out.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  return {
    requests,
    listen: () => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    close: () => new Promise((res) => server.close(() => res(null)))
  };
}

test('协议：下单请求 Authorization 符合官方格式且 RSA 验签通过', async () => {
  const keys = makeKeys();
  let captured = null;
  const fake = startFakeWx((record) => {
    captured = record;
    return { status: 200, body: { prepay_id: 'prepay-test-1' } };
  });
  const port = await fake.listen();
  try {
    const adapter = new HttpWxPayAdapter({
      configured: true, mchid: MCHID, appid: APPID, apiV3Key: APIV3,
      privateKeyPath: keys.merchantKeyPath, serialNo: SERIAL,
      notifyUrl: 'https://api.test/notify',
      endpointBase: `http://127.0.0.1:${port}`
    });
    const { prepayId } = await adapter.createJsapiOrder({
      outTradeNo: 'ORDER-1', amountFen: 16833, openid: 'o-1',
      description: '拼单商品份额', notifyUrl: 'https://api.test/notify'
    });
    assert.equal(prepayId, 'prepay-test-1');
    assert.ok(captured);
    const auth = captured.headers.authorization ?? '';
    assert.match(auth, /^WECHATPAY2-SHA256-RSA2048 /);
    assert.match(auth, new RegExp(`mchid="${MCHID}"`));
    assert.match(auth, new RegExp(`serial_no="${SERIAL}"`));
    const nonceMatch = auth.match(/nonce_str="([0-9a-f]+)"/);
    const tsMatch = auth.match(/timestamp="(\d+)"/);
    const sigMatch = auth.match(/signature="([^"]+)"/);
    const message = `POST
/v3/pay/transactions/jsapi
${tsMatch[1]}
${nonceMatch[1]}
${captured.body}
`;
    assert.equal(rsaVerify(keys.merchantPublicKey, message, sigMatch[1]), true);
    const sent = JSON.parse(captured.body);
    assert.equal(sent.appid, APPID);
    assert.equal(sent.mchid, MCHID);
    assert.equal(sent.out_trade_no, 'ORDER-1');
    assert.equal(sent.amount.total, 16833);
    assert.equal(sent.payer.openid, 'o-1');
  } finally {
    await fake.close();
  }
});

test('paySign：串 = appId\n时间戳\n随机串\npackage\n，可验签', () => {
  const keys = makeKeys();
  const adapter = new HttpWxPayAdapter({
    configured: true, mchid: MCHID, appid: APPID, apiV3Key: APIV3,
    privateKeyPath: keys.merchantKeyPath, serialNo: SERIAL, notifyUrl: ''
  });
  const pkg = 'prepay_id=prepay-abc';
  const full = adapter.signPayParamsFull(pkg);
  const message = `${APPID}\n${full.timeStamp}\n${full.nonceStr}\n${pkg}\n`;
  assert.equal(rsaVerify(keys.merchantPublicKey, message, full.paySign), true);
});

test('未配置凭据：全部方法抛 WECHAT_PAY_NOT_CONFIGURED', () => {
  const adapter = new HttpWxPayAdapter({
    configured: false, mchid: null, appid: null, apiV3Key: null,
    privateKeyPath: null, serialNo: null, notifyUrl: ''
  });
  assert.equal(adapter.configured, false);
  assert.throws(() => adapter.signPayParams('prepay_id=x'), (e) => e.code === 'WECHAT_PAY_NOT_CONFIGURED');
  assert.rejects(() => adapter.createJsapiOrder({ outTradeNo: 'a', amountFen: 1, openid: 'o', description: 'd', notifyUrl: 'n' }), (e) => e.code === 'WECHAT_PAY_NOT_CONFIGURED');
});

test('回调验签：平台私钥签名验证通过/篡改失败', () => {
  const keys = makeKeys();
  const adapter = new HttpWxPayAdapter({
    configured: true, mchid: MCHID, appid: APPID, apiV3Key: APIV3,
    privateKeyPath: keys.merchantKeyPath, serialNo: SERIAL, notifyUrl: '',
    platformPublicKeyPath: keys.platformPubPath
  });
  const body = '{"id":"evt-1"}';
  const timestamp = '1700000000';
  const nonce = 'n-123';
  const goodSig = rsaSign(keys.platformPrivateKey, `${timestamp}\n${nonce}\n${body}\n`);
  assert.equal(adapter.verifyNotifySignature({ timestamp, nonce, body, signature: goodSig }), true);
  assert.equal(adapter.verifyNotifySignature({ timestamp, nonce, body: body + ' ', signature: goodSig }), false);
});

test('decryptResource：AES-256-GCM 解密（tag 后置 16 字节，AAD 参与认证）', () => {
  const keys = makeKeys();
  const adapter = new HttpWxPayAdapter({
    configured: true, mchid: MCHID, appid: APPID, apiV3Key: APIV3,
    privateKeyPath: keys.merchantKeyPath, serialNo: SERIAL, notifyUrl: ''
  });
  const nonce = 'n-1234567890';
  const aad = 'transaction';
  const plain = '{"out_trade_no":"ORDER-1"}';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(APIV3, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  const ciphertextB64 = Buffer.concat([data, cipher.getAuthTag()]).toString('base64');
  assert.equal(adapter.decryptResource(ciphertextB64, nonce, aad), plain);
});
