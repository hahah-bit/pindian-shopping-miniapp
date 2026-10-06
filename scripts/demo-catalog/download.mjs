import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
// 商品素材下载，不依赖外链运行；原图与来源保存在清单。
for(const product of manifest.products) for(const image of product.images){
  const path=resolve(root,image.file);mkdirSync(dirname(path),{recursive:true});
  const url=image.url+'?fm=jpg&fit=max&w=1000&q=82';
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw Error(`${product.key} 下载失败 HTTP ${r.status}`);
  const bytes=Buffer.from(await r.arrayBuffer());
  if(bytes[0]!==0xff||bytes[1]!==0xd8||bytes.length>5*1024*1024)throw Error('素材不是合格JPEG');
  writeFileSync(path,bytes);image.sha256=createHash('sha256').update(bytes).digest('hex');
  image.downloadUrl=url;image.sizeBytes=bytes.length;
  console.log(`${product.key} ${image.file} ${bytes.length} bytes`);
}
writeFileSync(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
