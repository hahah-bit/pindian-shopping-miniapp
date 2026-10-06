import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {miniHarness} from '../../helpers/mini-page/harness.mjs';
const route='/features/ai-support/pages/chat/index';
const flush=()=>new Promise(r=>setImmediate(r));
const turn=(text)=>({id:randomUUID(),clientMessageId:randomUUID(),text,reply:'本人回复',status:'completed',createdAt:new Date().toISOString()});
function setup(t){
 const h=miniHarness({base:'http://127.0.0.1:1'});t.after(()=>h.close());h.storage.set('pindian_user_token','alice');
 const histories={alice:[turn('Alice的私有问题')],bob:[turn('Bob的私有问题')]},waiting=[],posts=[];let delayAlice=false;
 const success=(o,data)=>o.success({statusCode:200,data:{data}});
 h.wx.request=o=>{const owner=o.header.Authorization?.replace('Bearer ','');if(o.url.includes('/auth/me'))success(o,{id:owner,nickname:owner});else if(o.method==='POST')posts.push({o,owner});else if(delayAlice&&owner==='alice')waiting.push(o);else success(o,{items:histories[owner]??[],nextBefore:null});};
 const page=h.page('features/ai-support/pages/chat/index.ts');return{h,page,histories,waiting,posts,success,delay(){delayAlice=true;}};
}
test('T014 客服是第3原生Tab，两个旧入口直接switchTab，人工中心仍可达',t=>{
 const config=JSON.parse(readFileSync('apps/mini-program/miniprogram/app.json','utf8'));
 assert.equal(config.tabBar.list[2].pagePath,route.slice(1));assert.equal(config.tabBar.list.length,4);
 const h=miniHarness({base:'http://127.0.0.1:1'});t.after(()=>h.close());h.wx.switchTab=o=>h.events.push({kind:'tab',...o});
 h.page('features/profile/pages/index/index.ts').openSupport();h.page('features/cs/pages/index/index.ts').openAi();
 assert.equal(h.events.filter(e=>e.kind==='tab'&&e.url===route).length,2);
 h.page('features/ai-support/pages/chat/index.ts').human();assert.ok(h.events.some(e=>e.kind==='navigate'&&e.url==='/features/cs/pages/index/index'));
});
test('T014 缓存客服Tab再次进入校验身份，退出清私有历史/草稿，隐藏停止动效',async t=>{
 const s=setup(t);await s.page.load();s.page.setData({draft:'Alice尚未发送'});s.page.onHide();assert.equal(s.page.data.visible,false);
 s.h.storage.delete('pindian_user_token');await s.page.onShow();await flush();assert.equal(s.page.data.loggedIn,false);assert.equal(s.page.data.messages.length,0);assert.equal(s.page.data.draft,'');
 s.h.storage.set('pindian_user_token','bob');await s.page.onShow();await flush();assert.equal(s.page.data.userId,'bob');assert.equal(s.page.data.messages[0].text,'Bob的私有问题');
});
test('T014 迟到历史载入不得覆盖已切换用户',async t=>{
 const s=setup(t);s.delay();const old=s.page.load();await flush();assert.equal(s.waiting.length,1);
 s.h.storage.set('pindian_user_token','bob');await s.page.load();s.success(s.waiting[0],{items:s.histories.alice,nextBefore:null});await old;
 assert.equal(s.page.data.userId,'bob');assert.equal(s.page.data.messages[0].text,'Bob的私有问题');
});

test('T014 同身份新载入优先，旧分页在切换身份后失效',async t=>{
 const s=setup(t);await s.page.load();s.delay();const old=s.page.load();await flush();
 const fresh=s.page.load();await flush();s.success(s.waiting[1],{items:[turn('新的本人历史')],nextBefore:null});await fresh;
 s.success(s.waiting[0],{items:s.histories.alice,nextBefore:null});await old;assert.equal(s.page.data.messages[0].text,'新的本人历史');
 s.page.setData({nextBefore:randomUUID()});const older=s.page.older();await flush();
 s.h.storage.set('pindian_user_token','bob');await s.page.load();s.success(s.waiting[2],{items:s.histories.alice,nextBefore:null});await older;
 assert.equal(s.page.data.messages[0].text,'Bob的私有问题');assert.equal(s.page.data.olderLoading,false);
});

test('T014 同身份返回保留未落库失败消息，同键服务端记录优先且不重复',async t=>{
 const s=setup(t);await s.page.load();const failed={...turn('等待重试的问题'),id:'',status:'failed',reply:null};
 s.page.setData({messages:[...s.page.data.messages,failed]});await s.page.load();assert.equal(s.page.data.messages.at(-1).clientMessageId,failed.clientMessageId);
 s.histories.alice.push({...failed,id:randomUUID(),status:'completed',reply:'恢复的真实回复'});await s.page.load();
 assert.equal(s.page.data.messages.filter(x=>x.clientMessageId===failed.clientMessageId).length,1);assert.equal(s.page.data.messages.at(-1).reply,'恢复的真实回复');
});
test('T014 旧用户发送完成不得解除新用户sending或串入新对话',async t=>{
 const s=setup(t);await s.page.load();s.page.setData({draft:'Alice发送'});const old=s.page.send();await flush();
 s.h.storage.set('pindian_user_token','bob');await s.page.load();s.page.setData({draft:'Bob发送'});const current=s.page.send();await flush();assert.equal(s.posts.length,2);
 const reply=p=>s.success(p.o,{turn:{...turn(p.o.data.text),clientMessageId:p.o.data.clientMessageId},replayed:false});
 reply(s.posts[0]);await old;assert.equal(s.page.data.sending,true);assert.equal(s.page.data.messages.some(x=>x.text==='Alice发送'),false);
 reply(s.posts[1]);await current;assert.equal(s.page.data.sending,false);assert.equal(s.page.data.messages.at(-1).text,'Bob发送');
});
test('T014 同身份发送中切Tab回来保留pending，关闭动效不影响文字发送',async t=>{
 const s=setup(t);await s.page.load();s.page.setData({draft:'等待真实回复'});const pending=s.page.send();await flush();const key=s.page.data.messages.at(-1).clientMessageId;
 s.page.onHide();await s.page.onShow();await flush();assert.equal(s.page.data.messages.at(-1).clientMessageId,key);assert.equal(s.posts.length,1);
 s.page.toggleMotion();assert.equal(s.page.data.reducedMotion,true);assert.equal(s.page.data.sending,true);
 s.success(s.posts[0].o,{turn:{...turn('等待真实回复'),clientMessageId:key},replayed:false});await pending;assert.equal(s.page.data.messages.at(-1).status,'completed');
});
