import {ApplicationError} from '../shared/kernel';
import type {MiniCatalogQueries} from './catalog-queries';
import type {AiCatalogPort,CatalogGuidanceQuery,ProductRecommendation} from '../contexts/customer-service/application/ai-support/ports';
import {catalogGuidanceQuery} from '../contexts/customer-service/domain/product-guidance';
/** 只调用商品公开应用查询，不读取他域仓储或后台商品。 */
export class AiCatalogRead implements AiCatalogPort {
  constructor(private readonly catalog:Pick<MiniCatalogQueries,'list'|'get'>){}
  async search(raw:CatalogGuidanceQuery,signal?:AbortSignal):Promise<ProductRecommendation[]> {
    const q=catalogGuidanceQuery(raw);const ids:string[]=[];
    const check=()=>{if(signal?.aborted)throw new ApplicationError('AI_TIMEOUT','商品检索已取消');};
    for(let page=1;page<=2&&ids.length<3;page++){
      check();const result=await this.catalog.list({page,pageSize:20,keyword:q.keyword,category:q.category});check();
      for(const item of result.items)if(item.stockStatus==='available'&&!ids.includes(item.id)&&ids.length<3)ids.push(item.id);
      if(page*20>=result.total)break;
    }
    const cards:ProductRecommendation[]=[];
    for(const id of ids){
      check();try{const p=await this.catalog.get(id);check();if(p.stockStatus==='available')cards.push({productId:p.id,name:p.name,description:p.description.slice(0,600),imageUrl:p.mainImageUrl??null,priceFromFen:p.priceFromFen});}
      catch(e){if(!(e instanceof ApplicationError&&e.code==='NOT_FOUND'))throw e;}
    }
    return cards;
  }
}
