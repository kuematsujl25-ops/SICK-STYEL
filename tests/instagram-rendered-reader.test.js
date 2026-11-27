import {test} from 'node:test';import assert from 'node:assert/strict';
import {readVisibleConversation} from '../tools/instagram-preview/rendered-reader.js';
import {previewBatch} from '../tools/instagram-preview/model.js';
const scope={owner:'example_owner',capturedAt:'2026-10-31T00:00:00Z',rangeStart:'2026-10-01',rangeEnd:'2026-10-31',timeZone:'Asia/Tokyo'};
const el=(text='',rect={},attrs={})=>({textContent:text,children:[],getAttribute:k=>attrs[k]??null,closest:()=>null,getBoundingClientRect:()=>({left:0,right:100,width:100,height:20,top:0,bottom:20,...rect})});
function fixture({outbound=false,label='2026/10/20 9:29',text='SYNTHETIC_PRIVATE_ADDRESS',owner='example_owner',secondPeer=false,insideBody=false}={}){
 const row=el('',{right:1000,width:1000});row.style={justifyContent:outbound?'flex-end':'flex-start'};
 const parent=el();parent.parentElement=row;parent.style={flexDirection:outbound?'row-reverse':'row'};
 const article=el(text,{left:outbound?700:0,right:outbound?1000:300,width:300,top:60,bottom:80});article.parentElement=parent;
 const time=el(label,{left:450,right:550,top:30,bottom:50});if(insideBody)time.closest=()=>article;
 const main={querySelectorAll:s=>s==='a[href]'?[el('',{}, {href:'/example_peer/'}),...(secondPeer?[el('',{}, {href:'/another_peer/'})]:[])]:s==='[role="article"]'?[article]:[time]};
 return {dom:{querySelectorAll:()=>[el(owner)],querySelector:()=>main},style:e=>e.style};
}
test('rendered reader minimizes output and requires unique owner/peer binding',()=>{
 const f=fixture(),b=readVisibleConversation(scope,f.dom,f.style);assert.equal(b.events[0].date,'2026-10-20');assert.equal(b.events[0].direction,'inbound');assert.equal(b.events[0].verified,false);assert.ok(!JSON.stringify(b).includes('PRIVATE'));assert.doesNotThrow(()=>previewBatch(b,scope.owner));
 for(const opts of [{owner:'another_owner'},{secondPeer:true}]){const f=fixture(opts);assert.throws(()=>readVisibleConversation(scope,f.dom,f.style));}
});
test('rendered reader never promotes body dates, relative weekdays or Zoom words to verified facts',()=>{
 for(const options of [{label:'13:33 (水)'},{insideBody:true},{label:'2026/02/30 9:29'}]){const f=fixture(options);assert.equal(readVisibleConversation(scope,f.dom,f.style).events[0].date,null);}
 const f=fixture({outbound:true,text:'Zoom SYNTHETIC_PRIVATE_ADDRESS'}),b=readVisibleConversation(scope,f.dom,f.style);assert.equal(b.events.length,2);assert.equal(b.events[1].evidence,'ambiguous_zoom');assert.ok(b.events.every(e=>!e.historyStartSeen&&!e.firstOutboundConfirmed&&!e.verified));assert.ok(!JSON.stringify(b).includes('PRIVATE'));
});
