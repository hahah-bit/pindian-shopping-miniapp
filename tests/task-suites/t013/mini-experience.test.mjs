import test from 'node:test';
import assert from 'node:assert/strict';
import {localStack,product} from '../../helpers/local-stack.mjs';
import {miniHarness} from '../../helpers/mini-page/harness.mjs';
test('F019 回归：商品详情直接下单传当前商品ID，F049真实搜索分类与上架隔离',async t=>{
  const s=await localStack(t,'t011');const a=await s.login('alice');a.address=await s.address(a.token);
  const p=await product(s,{name:'测试红苹果',category:'fruit'});
  await product(s,{name:'测试杏仁',category:'snack'});
  const page=await s.http('/mini/v1/products?keyword=苹果&category=fruit&pageSize=1');
  assert.equal(page.total,1);assert.equal(page.items[0].id,p.id);assert.equal(page.items[0].category,'fruit');
  assert.equal((await s.http('/mini/v1/products?keyword=苹果&category=snack')).total,0);
  assert.equal((await s.http('/mini/v1/products?keyword=%25')).total,0,'百分号是字面量而不是SQL通配符');
  await s.http('/mini/v1/products?category=invalid',{status:400});
  const h=miniHarness(s);t.after(()=>h.close());h.storage.set('pindian_user_token',a.token);
  h.wx.setNavigationBarTitle=()=>{};const detail=h.page('features/catalog/pages/detail/index.ts');
  detail.onLoad({id:p.id});await h.idle();
  detail.toggleSelectShare({currentTarget:{dataset:{units:30}}});await detail.openOrderPanel();
  await detail.submitOrder();await h.idle();
  assert.ok(h.events.find(e=>e.kind==='navigate'&&e.url.includes('/orders/pages/detail/')),'点击必须实际创建订单');
  const orders=await s.http('/mini/v1/orders',{token:a.token});assert.equal(orders.items.length,1);
  assert.equal(orders.items[0].status,'unpaid');
  await s.http(`/admin/v1/products/${p.id}/unpublish`,{token:s.superToken,method:'POST'});
  assert.equal((await s.http('/mini/v1/products?keyword=苹果')).total,0);
});
test('F050 定位辅助：成功要求重新确认地区；取消/拒绝保留表单可手填',async t=>{
  const h=miniHarness({base:'http://127.0.0.1:1'});t.after(()=>h.close());
  const form=h.page('features/address/pages/form/index.ts');
  form.setData({form:{receiverName:'测试',phone:'13800000000',province:'浙江省',city:'杭州市',district:'西湖区',detail:'原地址1号'}});
  h.wx.chooseLocation=o=>o.fail({errMsg:'chooseLocation:fail cancel'});
  await form.chooseLocation();assert.equal(form.data.form.detail,'原地址1号');assert.equal(form.data.error,'');
  h.wx.chooseLocation=o=>o.fail({errMsg:'chooseLocation:fail auth deny'});
  await form.chooseLocation();assert.equal(form.data.form.detail,'原地址1号');assert.ok(form.data.locationHint.includes('手动'));
  h.wx.chooseLocation=o=>o.success({address:'北京市海淀区中关村大街',name:'1号楼',latitude:39,longitude:116});
  await form.chooseLocation();assert.ok(form.data.form.detail.includes('1号楼'));assert.equal(form.data.form.province,'');
  assert.ok(form.validate().includes('省市区'));assert.equal(form.data.form.receiverName,'测试');
  form.onRegionChange({detail:{value:['北京市','北京市','海淀区']}});assert.equal(form.validate(),'');
});

test('F019 搜索与分类切换不被迟到请求覆盖，分页和失败可恢复',async t=>{
 const h=miniHarness({base:'http://127.0.0.1:1'});t.after(()=>h.close());const pending=[];
 h.wx.request=o=>pending.push(o);const page=h.page('features/catalog/pages/index/index.ts');
 const row=(id)=>({id,name:id,userWholePriceFen:1501,originalPriceFen:1001,priceFromFen:300,stockStatus:'available'});
 const success=(i,items,total=items.length)=>pending[i].success({statusCode:200,data:{data:{items,total,page:1,pageSize:10}}});
 page.setData({keyword:'旧搜索'});const old=page.reload();page.setData({keyword:'新搜索',category:'snack'});const current=page.reload();
 success(1,[row('最新结果')]);await current;success(0,[row('旧结果')]);await old;assert.equal(page.data.items[0].id,'最新结果');assert.equal(page.data.loading,false);assert.ok(pending[1].url.includes('category=snack'));
 page.setData({hasMore:true});const more=page.loadMore();const newer=page.reload();success(3,[],0);await newer;success(2,[row('旧分页')],3);await more;assert.equal(page.data.items.length,0);assert.equal(page.data.loadingMore,false);
 const failure=page.reload();pending[4].fail();await failure;assert.ok(page.data.error);const retry=page.reload();success(5,[row('恢复结果')]);await retry;assert.equal(page.data.error,'');assert.equal(page.data.items[0].id,'恢复结果');
});

test('F019 未登录的我的页面必须显示登录入口，不被未读数请求挡住',async t=>{
 const h=miniHarness({base:'http://127.0.0.1:1'});t.after(()=>h.close());const page=h.page('features/profile/pages/index/index.ts');await page.load();assert.equal(page.data.user,null);assert.equal(page.data.error,'');assert.equal(page.data.loading,false);
});
