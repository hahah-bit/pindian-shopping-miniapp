import test from 'node:test';
import assert from 'node:assert/strict';
import {localStack,product} from '../../helpers/local-stack.mjs';
test('F049 真实HTTP/PG：分类与搜索 AND、字面量、过滤后分页、下架隔离',async t=>{
 const s=await localStack(t,'t011');
 const apple=await product(s,{name:'苹果苹果',category:'fruit'});
 await product(s,{name:'苹果干',category:'snack'});
 await product(s,{name:'青苹果',category:'fruit'});
 const one=await s.http('/mini/v1/products?keyword=苹果&category=fruit&pageSize=1');
 const two=await s.http('/mini/v1/products?keyword=苹果&category=fruit&pageSize=1&page=2');
 assert.equal(one.total,2);assert.equal(two.total,2);assert.notEqual(one.items[0].id,two.items[0].id);
 assert.equal(one.items[0].category,'fruit');assert.equal((await s.http('/mini/v1/products?keyword=%25')).total,0);
 await s.http('/mini/v1/products?category=bad',{status:400});
 await s.http(`/admin/v1/products/${apple.id}/unpublish`,{token:s.superToken,method:'POST'});
 assert.equal((await s.http('/mini/v1/products?keyword=苹果&category=fruit')).total,1);
 await s.http(`/mini/v1/products/${apple.id}`,{status:404});
});
