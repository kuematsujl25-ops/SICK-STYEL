import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf(" d.querySelectorAll('[data-mtgsync]')"),src.indexOf(" document.querySelector('#close')",src.indexOf(" d.querySelectorAll('[data-mtgsync]')")));
test('会議API失敗後は最新revisionとuncertain状態を再取得し、失敗時は古い操作画面を閉じる',async()=>{
 for(const failRead of [false,true]){const btn={dataset:{mtgsync:'initial:create'},disabled:false},calls=[];let shown=null,closed=false;
 const c=vm.createContext({captureNoteDraft:()=>({'note-body':'Draft transcript'}),confirmMeetingPlan:async()=>true,d:{open:true,querySelector:()=>({}),querySelectorAll:()=>[btn],close:()=>closed=true},record:{id:'qa'},state:{revision:1},kind:'initial',FormData:class{constructor(){return [];}},meetingFormChanged:()=>false,toast:()=>{},render:()=>{},meetingEditor:x=>shown=x,document:{querySelector:()=>({})},api:async route=>{calls.push(route);if(route==='orgsales/meeting-preview')return {attendees:[],confirmation:'mock'};if(route==='orgsales/meeting'||failRead)throw Error('dummy');return {revision:3,orgSales:[{id:'qa',initialMeetingSync:{status:'uncertain'}}]};}});
 vm.runInContext(block,c);await btn.onclick();assert.deepEqual(calls,['orgsales/meeting-preview','orgsales/meeting','data']);if(failRead)assert.ok(closed);else{assert.equal(c.state.revision,3);assert.equal(shown.initialMeetingSync.status,'uncertain');}
 }
});

test('団体の通常編集は画面から外した既存会議・履歴を維持する',async()=>{
 const start=src.indexOf(" document.querySelector('#orgform').onsubmit");
 const save=src.slice(start,src.indexOf(" const del=document.querySelector('#delete')",start));
 const form={},button={},record={id:'qa',stage:'DM送信',history:[],initialMeetingContent:'既存の説明',proposalMeetingContent:'旧会議',proposalZoomAt:'2026-12-01T10:00',proposalZoomUrl:'https://example.com/join',proposalMeetingSync:{status:'zoom_only',zoomMeetingId:'123'}};
 let persisted;
 const c=vm.createContext({document:{querySelector:s=>s==='#orgform'?form:button},record,state:{orgSales:[record]},FormData:class{constructor(){return Object.entries({stage:'DM送信',name:'Edited'});}},persist:async x=>persisted=JSON.parse(JSON.stringify(x)),toast:()=>{}});
 vm.runInContext(save,c);await form.onsubmit({preventDefault(){},target:{}});
 for(const key of ['initialMeetingContent','proposalMeetingContent','proposalZoomAt','proposalZoomUrl','proposalMeetingSync','history'])assert.deepEqual(persisted.orgSales[0][key],record[key]);
});

test('数値承認・取消で入力中の議事録を保持し、未保存会議があればAPIを呼ばない',async()=>{
 const start=src.indexOf(' const captureNoteDraft='),end=src.indexOf(' const noteImport=',start),code=src.slice(start,end)+';globalThis.runNote=noteAction;';
 for(const dirty of [false,true])for(const action of ['approve','undo']){
  const draft={'note-source':'https://app.notta.ai/example/new','note-at':'2026-12-01T10:00','note-summary':'Draft summary','note-body':'Unsaved transcript','note-consent':true};let shown=null,calls=0;
  const c=vm.createContext({d:{querySelector:id=>id==='#note-consent'?{type:'checkbox',checked:true}:{value:draft[id.slice(1)]}},record:{id:'qa'},kind:'initial',state:{revision:1},captureNoteDraft:()=>draft,meetingFormChanged:()=>dirty,FormData:class{constructor(){return [];}},api:async()=>{calls++;return {revision:2,orgSales:[{id:'qa'}]};},render:()=>{},meetingEditor:(o,k,d)=>shown=d});
  vm.runInContext(code,c);await c.runNote({action},{disabled:false});if(dirty){assert.equal(calls,0);assert.equal(shown,null);}else{assert.equal(calls,2);assert.deepEqual(JSON.parse(JSON.stringify(shown)),draft);}
 }
});
