import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBoundConversation} from '../tools/instagram-preview/dom-adapter.js';
import {previewBatch,stagePreview} from '../tools/instagram-preview/model.js';
// Minimal synthetic DOM tree implementing only standard APIs consumed by the adapter.
// These fixtures do not assert Instagram selectors or layout compatibility.
function element(text='',left=0,width=100,attrs={},children=[]){return {textContent:text,getAttribute:k=>attrs[k]??null,getBoundingClientRect:()=>({left,right:left+width,width,height:20}),contains(n){return children.includes(n)||children.some(c=>c.contains(n));}};}
const scope={capturedAt:'2026-10-30T12:00:00Z',rangeStart:'2026-10-01',rangeEnd:'2026-10-30',timeZone:'Asia/Tokyo'};
const links=()=>({ownerLink:element('',0,100,{href:'/_demo_owner_/'}),peerLink:element('',0,100,{href:'/demo_peer/'})});
const message=(text,left=0,dateText='2026/10/23 9:29',width=300)=>{const article=element(text,left,width);return {article,row:element('',0,1000,{},[article]),dateLabel:element(dateText)};};
test('DOM adapter returns only allowlisted facts and never private text or unknown fields',()=>{
 const secret='SYNTHETIC_PRIVATE_ADDRESS_123';
 const b=collectBoundConversation({...links(),messages:[message(secret),message('Zoom '+secret,700)],body:secret,attachment:secret,url:'https://example.com/private'}, {...scope,secret});
 const json=JSON.stringify(b);assert.ok(!json.includes(secret));assert.ok(!json.includes('example.com'));assert.ok(!json.includes('Zoom '));
 assert.deepEqual(Object.keys(b).sort(),['version','owner','source','capturedAt','rangeStart','rangeEnd','coverage','events'].sort());
 assert.equal(b.events.length,3);assert.ok(b.events.every(e=>!e.verified));assert.equal(stagePreview([],previewBatch(b,'_demo_owner_')).length,0);
});
test('message body dates and relative weekdays never become UI dates',()=>{
 for(const label of ['13:33 (水)','2026/02/30 9:29','2026/10/23 25:29','']){
  const b=collectBoundConversation({...links(),messages:[message('2026/10/23 9:29',0,label)]},scope);assert.equal(b.events[0].date,null);
 }
 const m=message('2026/10/23 9:29');m.dateLabel=m.article;
 assert.equal(collectBoundConversation({...links(),messages:[m]},scope).events[0].date,null);
});
test('timezone unknown, hidden date and timestamp containing message are not trusted',()=>{
 const m=message('private');
 assert.equal(collectBoundConversation({...links(),messages:[m]},{...scope,timeZone:'unknown'}).events[0].date,null);
 m.dateLabel=element('2026/10/23 9:29',0,100,{'aria-hidden':'true'});
 assert.equal(collectBoundConversation({...links(),messages:[m]},scope).events[0].date,null);
 m.dateLabel=element('2026/10/23 9:29',0,100,{},[m.article]);
 assert.equal(collectBoundConversation({...links(),messages:[m]},scope).events[0].date,null);
});
test('ambiguous layout remains pending; incoming Zoom is not an outgoing invitation',()=>{
 const b=collectBoundConversation({...links(),messages:[message('Zoom',350),message('Zoom',0)]},scope);
 assert.deepEqual(b.events.map(e=>[e.type,e.direction]),[['zoom_invite','unknown'],['reply','inbound']]);
 assert.equal(b.events[0].reason,'direction_unknown');assert.equal(b.events[0].date,'2026-10-23');
});
test('visible outbound is never asserted to be first-ever DM or an explicit invitation',()=>{
 const b=collectBoundConversation({...links(),messages:[message('Zoomでご説明します',700),message('followup',700)]},scope);
 assert.equal(b.events.filter(e=>e.type==='new_dm').length,1);
 assert.ok(b.events.every(e=>!e.historyStartSeen&&!e.firstOutboundConfirmed&&!e.verified));
 assert.equal(b.events.find(e=>e.type==='zoom_invite').evidence,'ambiguous_zoom');
});
test('invalid identity, oversized batches, hidden elements and non-contained articles fail closed',()=>{
 assert.throws(()=>collectBoundConversation({...links(),peerLink:element('',0,100,{href:'/direct/t/123/'}),messages:[]},scope));
 assert.throws(()=>collectBoundConversation({...links(),messages:Array(101).fill(message('x'))},scope));
 const m=message('Zoom');m.row=element();assert.equal(collectBoundConversation({...links(),messages:[m]},scope).events.length,0);
 const hidden=message('Zoom');hidden.article=element('Zoom',0,0);hidden.row=element('',0,1000,{},[hidden.article]);
 assert.equal(collectBoundConversation({...links(),messages:[hidden]},scope).events.length,0);
});

test('scope strings cannot leak arbitrary text through metadata',()=>{
 for(const key of ['capturedAt','rangeStart','rangeEnd'])assert.throws(()=>collectBoundConversation({...links(),messages:[]},{...scope,[key]:'SYNTHETIC_PRIVATE_ADDRESS'}));
});
