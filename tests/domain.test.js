import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate } from '../lib/domain.js';

const fixtures={
 'tasks.due':v=>{const d=empty();d.tasks.push({id:'t1',title:'架空タスク',due:v,priority:'中',done:false});return d;},
 'shipments.due':v=>{const d=empty();d.shipments.push({id:'s1',title:'架空商品',order:'ORDER-0001',recipient:'テスト受取人',due:v,carrier:'テスト配送',tracking:'000000',status:'未発送'});return d;},
 'metrics.date':v=>{const d=empty();d.metrics.push({id:'m1',date:v,sales:1000,orders:1,followers:10,reach:100,engagement:5});return d;}
};
const cases=[['2024-02-29',true],['2000-02-29',true],['2023-02-29',false],['2100-02-29',false]];

for(const [field,build] of Object.entries(fixtures))for(const [v,ok] of cases){
 test(`${field}: ${v} を${ok?'受け付ける':'拒否する'}`,()=>{
  const d=build(v);
  if(ok)assert.deepEqual(validate(d),d);
  else assert.throws(()=>validate(d),/データの形式が正しくありません/);
 });
}
