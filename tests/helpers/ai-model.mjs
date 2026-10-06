import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
export async function modelServer(t,choose){
 const requests=[];const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);requests.push(payload);
  const choice=choose(payload,requests.length);
  if(choice.status){res.writeHead(choice.status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'受控渠道失败',type:'server_error'}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const delta of choice.deltas)res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'support-test',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'support-test',choices:[{index:0,delta:{},finish_reason:choice.stop??'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return{requests,url:'http://127.0.0.1:'+server.address().port+'/v1'};
}
export const toolChoice=(args,name='search_catalog')=>({deltas:[{role:'assistant',tool_calls:[{index:0,id:'call-'+randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}],stop:'tool_calls'});
export const textChoice=text=>({deltas:[{role:'assistant',content:text}]});
