import {ApplicationError} from '../../../shared/kernel';
export type GuidanceIntent='general'|'product_recommendation'|'product_introduction';
export interface ProductRecommendation {
  productId:string;name:string;description:string;imageUrl:string|null;priceFromFen:number;
}
export interface CatalogGuidanceQuery {
  keyword:string;category?:'fruit'|'snack'|'drink'|'other';intent:Exclude<GuidanceIntent,'general'>;
}
export interface AiReplyResult {text:string;intent:GuidanceIntent;recommendations:ProductRecommendation[];}
const intents=['general','product_recommendation','product_introduction'];
const categoryAliases=new Map<string,NonNullable<CatalogGuidanceQuery['category']>>([
  ['水果','fruit'],['水果商品','fruit'],['fruit','fruit'],
  ['零食','snack'],['零食商品','snack'],['snack','snack'],
  ['饮品','drink'],['饮料','drink'],['饮品商品','drink'],['drink','drink'],
  ['其他','other'],['其他商品','other'],['other','other']
]);
export function catalogGuidanceQuery(raw:unknown):CatalogGuidanceQuery {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ApplicationError('VALIDATION_FAILED','商品检索参数无效');
  const q=raw as Record<string,unknown>;
  if(Object.keys(q).some(k=>!['keyword','category','intent'].includes(k))||typeof q.keyword!=='string'||q.keyword.length>60||!['product_recommendation','product_introduction'].includes(String(q.intent))||(q.category!==undefined&&!['fruit','snack','drink','other'].includes(String(q.category))))throw new ApplicationError('VALIDATION_FAILED','商品检索参数无效');
  const keyword=q.keyword.trim(),alias=categoryAliases.get(keyword.toLowerCase());
  if(alias&&(q.category===undefined||q.category===alias))return{keyword:'',intent:q.intent as CatalogGuidanceQuery['intent'],category:alias};
  return{keyword,intent:q.intent as CatalogGuidanceQuery['intent'],...(q.category===undefined?{}:{category:q.category as CatalogGuidanceQuery['category']})};
}
export function aiReplyResult(raw:unknown):AiReplyResult {
  const invalid=()=>new ApplicationError('AI_UNAVAILABLE','智能客服暂时无法回答，请重试或联系人工客服');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid();
  const value=raw as Record<string,unknown>;
  if(typeof value.text!=='string'||!value.text.trim()||value.text.length>4000||!intents.includes(String(value.intent))||!Array.isArray(value.recommendations)||value.recommendations.length>3)throw invalid();
  const ids=new Set<string>();
  const recommendations=value.recommendations.map((item:unknown)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw invalid();const r=item as Record<string,unknown>;
    if(typeof r.productId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.productId)||ids.has(r.productId)||typeof r.name!=='string'||!r.name.trim()||r.name.length>60||typeof r.description!=='string'||r.description.length>600||!Number.isSafeInteger(r.priceFromFen)||Number(r.priceFromFen)<0||!(r.imageUrl===null||(typeof r.imageUrl==='string'&&/^https?:\/\//.test(r.imageUrl))))throw invalid();
    ids.add(r.productId);return{productId:r.productId,name:r.name,description:r.description,imageUrl:r.imageUrl as string|null,priceFromFen:r.priceFromFen as number};
  });
  if(value.intent==='general'&&recommendations.length)throw invalid();
  return{text:value.text.trim(),intent:value.intent as GuidanceIntent,recommendations};
}
