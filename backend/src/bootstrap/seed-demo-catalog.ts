import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {Pool} from 'pg';
import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {FoundationModule} from './foundation.module';
import {TOKENS} from './injection-tokens';
import {readConfig} from './config';
import {UploadMediaAsset} from '../contexts/catalog/application';
import type {ProductRepository} from '../contexts/catalog/application/ports';
import {CreateProductWorkflow,PublishProductWorkflow} from '../workflows';
import {RecordOperation} from '../contexts/audit/application';

async function main() {
  const config=readConfig();
  if(config.appEnv!=='local')throw Error('演示商品导入仅允许 APP_ENV=local');
  const manifestPath=resolve(process.argv[2] ?? 'scripts/demo-catalog/manifest.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {products:Array<{key:string;name:string;description:string;images:Array<{file:string;sha256:string}>;[key:string]:unknown}>};
  if(manifest.products.length!==10)throw Error('演示清单必须包含10件商品');
  const app=await NestFactory.createApplicationContext(FoundationModule,{logger:false});
  const pool=app.get<Pool>(TOKENS.PgPool);const client=await pool.connect();
  const checkpoint=resolve(config.mediaDir,'demo-catalog-import.json');
  let saved:Record<string,string[]>={};
  const save=()=>{writeFileSync(checkpoint+'.tmp',JSON.stringify(saved));renameSync(checkpoint+'.tmp',checkpoint);};
  let created=0;
  try {
    await client.query('SELECT pg_advisory_lock($1)',[88002026006]);
    saved=existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):{};
    const products=app.get<ProductRepository>(TOKENS.ProductRepository);
    for(const item of manifest.products){
      const marker=`[demo-catalog-v1:${item.key}]`;
      const remembered=saved[`product:${item.key}`]?.[0];
      const prior=(remembered?await products.findById(remembered):null)??(await products.listAdmin({keyword:item.name,page:1,pageSize:50})).items.find(p=>p.state.description.includes(marker));
      if(prior){saved[`product:${item.key}`]=[prior.state.productId];save();if(prior.state.status==='draft')await app.get(PublishProductWorkflow).execute({productId:prior.state.productId});console.log(`[demo] 已存在 ${item.name}`);continue;}
      const imageIds=saved[item.key]??=[];
      for(let index=imageIds.length;index<item.images.length;index++){
        const image=item.images[index]!;const imagePath=resolve(dirname(manifestPath),image.file);
        if(!imagePath.startsWith(dirname(manifestPath)+sep))throw Error('素材路径越界');
        const buffer=readFileSync(imagePath);
        if(createHash('sha256').update(buffer).digest('hex')!==image.sha256)throw Error('素材指纹不一致');
        const media=await app.get(UploadMediaAsset).execute({buffer,uploadedBy:null});imageIds.push(media.id);saved[item.key]=imageIds;save();
      }
      const {key,images,...fields}=item;
      const result=await app.get(CreateProductWorkflow).execute({input:{...fields,description:`${item.description}\n${marker}`,mainImageId:imageIds[0],detailImageIds:imageIds.slice(1)},actorAdminId:null});
      saved[`product:${item.key}`]=[result.productId];save();
      await app.get(PublishProductWorkflow).execute({productId:result.productId});
      await app.get(RecordOperation).execute({adminId:null,action:'demo_catalog.imported',resourceType:'product',resourceId:result.productId,detail:{key,source:'local-cli'}});
      created++;console.log(`[demo] 已创建 ${item.name}，${imageIds.length} 张图片`);
    }
    console.log(`[demo] 完成，本次新增 ${created} 件`);
  } finally {await client.query('SELECT pg_advisory_unlock($1)',[88002026006]).catch(()=>{});client.release();await app.close();await pool.end();}
}
void main().catch(()=>{console.error('演示导入失败，请检查本地配置和素材清单；可修复后重新运行。');process.exitCode=1;});
