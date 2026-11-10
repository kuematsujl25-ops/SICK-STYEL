import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {renderOrgList} from '../public/org-sales.js';
const line=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').split('\n').find(x=>x.startsWith(' const orgQ='));
test('団体検索を絞る→再描画→解除・変更しても元の一覧から再構築し入力位置を保持',()=>{
 const tasks=['alpha','beta'].map((name,i)=>({id:String(i),name,assignee:'',category:'サッカー',stage:'DM送信',history:[],notes:''}));
 let input,html,focused=false,selection;
 const c=vm.createContext({orgUI:{assignee:'all',stage:'all',sort:'updated',q:''},document:{querySelector:()=>input},render:()=>draw()});
 function draw(){html=renderOrgList(tasks,c.orgUI,String,'2026-10-23');input={value:c.orgUI.q,selectionStart:0,selectionEnd:0,focus(){focused=true;},setSelectionRange(a,b){selection=[a,b];}};vm.runInContext('{'+line+'}',c);}
 draw();input.value='alpha';input.selectionStart=input.selectionEnd=5;input.oninput({});assert.match(html,/1 \/ 2 件/);draw();
 input.value='';input.oninput({});assert.match(html,/2 \/ 2 件/);assert.ok(focused);assert.deepEqual(selection,[0,0]);
 input.value='beta';input.oninput({});assert.match(html,/data-editorg="1"/);assert.doesNotMatch(html,/data-editorg="0"/);
 const before=html;input.value='未確定';input.oninput({isComposing:true});assert.equal(html,before);input.oncompositionend({});assert.match(html,/0 \/ 2 件/);
});
