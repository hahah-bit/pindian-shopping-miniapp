import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {needsRehearsalCertificateRenewal} from '../../../scripts/release/rehearsal-tls.mjs';
test('F046 演练TLS只在缺失、无效或不足24小时有效时续建',()=>{
 const pem=readFileSync('data/release/tls/fullchain.pem','utf8');const end=Date.parse(new X509Certificate(pem).validTo);
 assert.equal(needsRehearsalCertificateRenewal(pem,end-2*86400000),false);
 assert.equal(needsRehearsalCertificateRenewal(pem,end-3600000),true);
 assert.equal(needsRehearsalCertificateRenewal(pem,end+1),true);
 assert.equal(needsRehearsalCertificateRenewal(undefined),true);
 assert.equal(needsRehearsalCertificateRenewal('invalid'),true);
});
