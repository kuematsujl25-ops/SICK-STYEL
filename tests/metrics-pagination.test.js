import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const renderer=source.slice(source.indexOf('let metricsPage=0;'),source.indexOf('function bindInstagram()'));
const binding=source.slice(source.indexOf('function bindMetricsPages()'),source.indexOf('function bind(){'));
function harness(n){
 const records=Array.from({length:n},(_,i)=>({id:'r'+i,date:new Date(Date.UTC(2020,0,i+1)).toISOString().slice(0,10),sales:i,orders:1,instagramEntered:false}));
 let html='',buttons=[];const context=vm.createContext({yen:String,empty:()=>'',document:{querySelectorAll:()=>buttons},render:()=>draw()});
 vm.runInContext(renderer+binding,context);
 const draw=()=>{html=context.renderSnsMetrics(records,String);buttons=[...html.matchAll(/<button data-metricspage="(-?\d+)" (disabled)?/g)].map(m=>({dataset:{metricspage:m[1]},disabled:!!m[2]}));context.bindMetricsPages();};draw();
 return {records,html:()=>html,draw,click:i=>{assert.ok(!buttons[i].disabled);buttons[i].onclick();},buttons:()=>buttons};
}
test('日次記録0/90/91/180/181件の境界と全ページの編集アクセス',()=>{
 for(const n of [0,90,91,180,181]){const h=harness(n),seen=[];
  for(let p=0;p<Math.max(1,Math.ceil(n/90));p++){seen.push(...[...h.html().matchAll(/data-edit="metrics:(r\d+)"/g)].map(m=>m[1]));if(p+1<Math.ceil(n/90))h.click(1);}
  assert.equal(new Set(seen).size,n);if(n>90){assert.equal(h.buttons()[1].disabled,true);h.click(0);assert.match(h.html(),/data-edit="metrics:/);}
 }
});
test('最終ページの最後の記録削除後は前ページへ補正し、編集入口を保持',()=>{
 const h=harness(91);h.click(1);assert.match(h.html(),/data-edit="metrics:r0"/);
 h.records.shift();h.draw();assert.equal([...h.html().matchAll(/data-edit="metrics:/g)].length,90);
 assert.doesNotMatch(h.html(),/data-metricspage/);
});
