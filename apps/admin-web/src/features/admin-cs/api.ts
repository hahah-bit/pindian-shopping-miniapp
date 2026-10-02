import {request, storedToken} from '../../platform/api-client';
export interface Conversation {id:string;status:string;hasAgent:boolean}
export interface Message {seq:number;sender:string;kind:string;internal?:boolean;content:Record<string,unknown>;createdAt:string}
export const cs=(path:string)=>`/api/admin/v1/cs/${path}`;
export const post=<T>(path:string,body?:unknown)=>request<T>(path,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
export async function imageUrl(id:string):Promise<string>{
  const r=await fetch(cs(`images/${id}`),{headers:{Authorization:`Bearer ${storedToken()??''}`},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error('图片读取失败');return URL.createObjectURL(await r.blob());
}
export function cardText(data:Record<string,unknown>):string {
  if(data.product){const p=data.product as {name:string;originalPriceFen:number};return `${p.name} · 商品价 ${(p.originalPriceFen/100).toFixed(2)} 元`;}
  if(data.order){const o=data.order as {orderNo:string;totalAmountFen:number};return `订单 ${o.orderNo} · ${(o.totalAmountFen/100).toFixed(2)} 元`;}
  if(data.group){const g=data.group as {paidUnits:number};return `拼单进度 ${g.paidUnits}/60`;}
  const r=data.refund as {paidAmountFen:number;items:Array<{status:string;amountFen:number}>};return `退款记录 · 实付 ${(r.paidAmountFen/100).toFixed(2)} 元 · ${r.items.length} 笔退款`;
}
