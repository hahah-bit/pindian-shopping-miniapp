import {X509Certificate} from 'node:crypto';
/** 仅用于本地演练临时TLS；提前24小时续建，不降低HTTPS校验。 */
export function needsRehearsalCertificateRenewal(pem,now=Date.now()){
 if(!pem)return true;
 try{const cert=new X509Certificate(pem);return Date.parse(cert.validTo)-now<=86400000||Date.parse(cert.validFrom)>now;}
 catch{return true;}
}
