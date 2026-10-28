import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nottaMeetingPlan,NOTTA_MARKER,NOTTA_ROUTING} from '../public/meeting-policy.js';
const org={name:'Example Club',initialMeetingContent:'説明'};
test('新規会議のみ識別し、既存URL・旧連携記録は対象にしない',()=>{
 assert.equal(nottaMeetingPlan(org,'initial').nottaRouting,NOTTA_ROUTING);
 for(const fields of [{initialZoomUrl:'https://zoom.us/j/123'},{initialMeetingSync:{status:'error'}}])assert.equal(nottaMeetingPlan({...org,...fields},'initial').nottaRouting,null);
});
test('失敗からの再試行・名称変更は識別を保持し、取消後の新規作成は対象になる',()=>{
 for(const status of ['error','zoom_only','synced']){
  const plan=nottaMeetingPlan({...org,name:'Updated Club',initialMeetingSync:{nottaRouting:NOTTA_ROUTING,status}},'initial');
  assert.equal(plan.summary,NOTTA_MARKER+' Updated Club｜説明');
 }
 assert.equal(nottaMeetingPlan({...org,initialMeetingSync:null,initialZoomUrl:''},'initial').nottaRouting,NOTTA_ROUTING);
});
test('利用者入力に予約タグを含めた旧会議の誤対象化を拒否する',()=>{
 assert.throws(()=>nottaMeetingPlan({...org,name:NOTTA_MARKER,initialMeetingSync:{status:'synced'}},'initial'),/専用識別タグ/);
});
