import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hasOutstandingMeetings,assertMeetingRecordsRetained} from '../public/org-meeting-lifecycle.js';
import {renderOrgList,newOrg} from '../public/org-sales.js';
import {renderAccounts} from '../public/accounts.js';
const workspace=o=>({orgSales:o});
test('会議の削除・記録消失を拒否し、取消完了後だけ団体を削除できる',()=>{
 for(const kind of ['initial','proposal'])for(const status of ['creating','uncertain','zoom_only','synced','error']){
  const org={id:'example',[kind+'MeetingSync']:{status,zoomMeetingId:'123'}};
  assert.equal(hasOutstandingMeetings(org),true);
  for(const next of [[],[{...org,deletedAt:'2026-10-23T00:00:00Z'}],[{...org,[kind+'MeetingSync']:null}]])assert.throws(()=>assertMeetingRecordsRetained(workspace([org]),workspace(next)),/会議/);
  assert.doesNotThrow(()=>assertMeetingRecordsRetained(workspace([org]),workspace([{...org,name:'updated'}])));
 }
 const cleared={id:'example',initialMeetingSync:null,proposalMeetingSync:null};
 assert.doesNotThrow(()=>assertMeetingRecordsRetained(workspace([cleared]),workspace([{...cleared,deletedAt:'2026-10-23T00:00:00Z'}])));
 assert.equal(hasOutstandingMeetings({initialMeetingSync:{status:'uncertain',zoomMeetingId:null}}),true);
});
test('削除済み団体は会議記録を保って復元でき、検索外でも復元導線が見える',()=>{
 const org={...newOrg(),id:'old',name:'Example Club',deletedAt:'2026-10-23T00:00:00Z',initialMeetingSync:{status:'zoom_only',zoomMeetingId:'123'}};
 const restored={...org,deletedAt:null};
 assert.doesNotThrow(()=>assertMeetingRecordsRetained(workspace([org]),workspace([restored])));
 const html=renderOrgList([org],{q:'notfound',stage:'all',assignee:'all'},String,'2026-10-23');
 assert.match(html,/data-restoreorg="old"/);assert.match(html,/復元だけでは会議作成・招待・取消は行いません/);
 assert.doesNotMatch(renderOrgList([{...org,initialMeetingSync:null}],{stage:'all',assignee:'all'},String,'2026-10-23'),/data-restoreorg/);
});
test('同名の別媒体は増加率に混ぜず、単一媒体の観測から算出する',()=>{
 const accounts=[{id:'1',accountName:'example',platform:'Instagram',observedAt:'2026-10-01',followers:100},{id:'2',accountName:'example',platform:'YouTube',observedAt:'2026-10-02',followers:1000}];
 for(const platform of ['all','Instagram','YouTube']){const html=renderAccounts(accounts,{platform},String);assert.doesNotMatch(html,/900%/);assert.match(html,/観測1回のみ/);}
 accounts.push({...accounts[0],id:'3',observedAt:'2026-10-03',followers:120});
 assert.match(renderAccounts(accounts,{platform:'Instagram'},String),/20%/);
 assert.match(renderAccounts(accounts,{platform:'YouTube'},String),/観測1回のみ/);
});
