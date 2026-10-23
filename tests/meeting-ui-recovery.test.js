import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf(" d.querySelectorAll('[data-mtgsync]')"),src.indexOf(" document.querySelector('#close')",src.indexOf(" d.querySelectorAll('[data-mtgsync]')")));
test('会議API失敗後は最新revisionとuncertain状態を再取得し、失敗時は古い操作画面を閉じる',async()=>{
 for(const failRead of [false,true]){const btn={dataset:{mtgsync:'initial:create'},disabled:false},calls=[];let shown=null,closed=false;
 const c=vm.createContext({confirm:()=>true,d:{querySelectorAll:()=>[btn],close:()=>closed=true},record:{id:'qa'},state:{revision:1},orgFormHasUnsavedChanges:()=>false,toast:()=>{},render:()=>{},orgEditor:x=>shown=x,api:async route=>{calls.push(route);if(route==='orgsales/meeting-preview')return {attendees:[],confirmation:'mock'};if(route==='orgsales/meeting'||failRead)throw Error('dummy');return {revision:3,orgSales:[{id:'qa',initialMeetingSync:{status:'uncertain'}}]};}});
 vm.runInContext(block,c);await btn.onclick();assert.deepEqual(calls,['orgsales/meeting-preview','orgsales/meeting','data']);if(failRead)assert.ok(closed);else{assert.equal(c.state.revision,3);assert.equal(shown.initialMeetingSync.status,'uncertain');}
 }
});

test('会議内容はフォーム保存後も初回・提案それぞれ維持される',async()=>{
 const start=src.indexOf(" document.querySelector('#orgform').onsubmit");
 const save=src.slice(start,src.indexOf(" const del=document.querySelector('#delete')",start));
 const form={},button={},record={id:'qa',stage:'DM送信',history:[]};
 let persisted;
 const c=vm.createContext({document:{querySelector:s=>s==='#orgform'?form:button},record,state:{orgSales:[record]},FormData:class{constructor(){return Object.entries({stage:'DM送信',initialMeetingContent:'初回の説明',proposalMeetingContent:'次回の提案'});}},persist:async x=>persisted=JSON.parse(JSON.stringify(x)),toast:()=>{}});
 vm.runInContext(save,c);await form.onsubmit({preventDefault(){},target:{}});
 assert.equal(persisted.orgSales[0].initialMeetingContent,'初回の説明');
 assert.equal(persisted.orgSales[0].proposalMeetingContent,'次回の提案');
});

test('旧団体の会議内容も未保存変更として検出し、既定表示だけなら変更扱いしない',()=>{
 const code=src.slice(src.indexOf('function orgFormHasUnsavedChanges'),src.indexOf('function orgEditor'));
 for(const [initial,proposal,expected] of [['初回ZOOM','活用法提案ZOOM',false],['変更','活用法提案ZOOM',true],['初回ZOOM','変更',true]]){
  const c=vm.createContext({document:{querySelector:()=>({})},FormData:class{constructor(){return [['initialMeetingContent',initial],['proposalMeetingContent',proposal]];}}});
  vm.runInContext(code,c);assert.equal(c.orgFormHasUnsavedChanges({id:'old'}),expected);
 }
});
