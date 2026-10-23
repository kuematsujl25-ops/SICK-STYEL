import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmMeetingPlan} from '../public/meeting-confirmation-ui.js';
class Element{
 children=[];style={};attributes={};
 append(...items){this.children.push(...items);}
 setAttribute(k,v){this.attributes[k]=v;}
 showModal(){this.open=true;}
 close(){this.open=false;}
 remove(){this.removed=true;}
}
const text=e=>[e.textContent||'',...e.children.map(text)].join(' ');
test('会議確認は重要項目・招待警告を表示し、戻る/閉じる/Escapeで実行しない',async()=>{
 const old=global.document;
 try{for(const action of ['prepare','create','update','cancel'])for(const choice of ['戻る','閉じる','Escape','確認して実行']){
  const body=new Element();global.document={body,createElement:()=>new Element()};
  const promise=confirmMeetingPlan({action,summary:'Example｜内容 <script>',start:'2026-12-01T10:00',zoomHost:'host@example.com',calendarId:'organizer@example.com',attendees:['guest@example.com'],zoomUrl:'https://zoom.us/j/123'});
  const dialog=body.children[0];assert.ok(dialog.open);
  for(const value of ['Example｜内容 <script>','日本時間・45分','host@example.com','organizer@example.com','guest@example.com','https://zoom.us/j/123'])assert.ok(text(dialog).includes(value));
  if(action==='prepare')assert.match(text(dialog),/招待はまだ送りません/);
  if(action==='cancel')assert.match(text(dialog),/削除.*取消通知/);
  const buttons=dialog.children.at(-1).children;
  if(choice==='Escape')dialog.oncancel({preventDefault(){}});
  else buttons.find(b=>b.textContent===choice).onclick();
  // A late/repeated event must not turn a cancellation into execution.
  buttons.find(b=>b.textContent==='確認して実行').onclick();
  assert.equal(await promise,choice==='確認して実行');assert.ok(dialog.removed);
 }}finally{global.document=old;}
});
