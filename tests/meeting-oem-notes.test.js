import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {createStore} from '../lib/store.js';import {empty,validate} from '../lib/domain.js';import {newOrg} from '../public/org-sales.js';import {previewMeeting} from '../lib/meeting-confirmation.js';import {syncMeeting} from '../lib/meeting-sync.js';import {saveMeetingFields,renderMeetingEditor} from '../public/meetings.js';import {assertMeetingRecordsRetained} from '../public/org-meeting-lifecycle.js';import {importNote,resolveFact,extractFacts} from '../lib/meeting-notes.js';import {writeMeetingNote} from '../lib/meeting-notes-store.js';
const org=()=>({...newOrg(),id:'oem-example',partyType:'oem',name:'Example Manufacturer',updatedAt:new Date().toISOString(),initialZoomAt:'2026-12-01T10:00'});
const input={kind:'initial',source:'https://app.notta.ai/example/note',body:'試用人数は12人で確定です。\n希望数は50個で確定です。\n提案数は30個で確定です。\n確定導入数は20個で確定です。',summary:'Example summary',meetingAt:'2026-12-01T10:00',consentConfirmed:true};
async function setup(t,o=org()){const dir=await mkdtemp(tmpdir()+'/ss-notes-');const store=await createStore({DATA_DIR:dir});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});const [r]=await store.put('workspace',validate({...empty(),orgSales:[o]}));return {store,revision:r.revision};}
test('OEM/その他はpreviewと同期の両方でネットワーク呼出し前に拒否、旧URL・履歴維持',async t=>{
 const o={...org(),initialMeetingType:'other'},x=await setup(t,o);const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('must not call');};t.after(()=>global.fetch=old);
 await assert.rejects(previewMeeting(x.store,{orgId:o.id,kind:'initial',action:'prepare',revision:x.revision}),/この会議種別/);await assert.rejects(syncMeeting(x.store,{orgId:o.id,kind:'initial',action:'create',revision:x.revision}),/この会議種別/);assert.equal(calls,0);
 assert.doesNotMatch(renderMeetingEditor(o,'initial',String,{zoomConnected:true,calendarConnected:true}),/data-mtgsync="initial:prepare"/);
 const existing={...org(),initialZoomUrl:'https://example.com/join'};assert.throws(()=>saveMeetingFields(existing,'initial',{initialMeetingType:'other',initialMeetingContent:'visit',initialZoomAt:o.initialZoomAt,initialMeetingDurationMin:30}),/種別/);
 assert.throws(()=>assertMeetingRecordsRetained({orgSales:[existing]},{orgSales:[{...existing,initialMeetingType:'other'}]}),/種別/);
});
test('議事録の確定値は空欄だけ反映、希望・提案・導入・売上数量を分離、再取込は冪等',()=>{
 const original=org(),a=importNote(original,input);assert.equal(a.org.trialUsers,12);assert.equal(a.org.desiredQty,50);assert.equal(a.org.proposedQty,30);assert.equal(a.org.confirmedQty,20);assert.equal(a.org.paidQty,null);
 assert.equal(importNote(a.org,input).duplicate,true);assert.throws(()=>importNote(a.org,{...input,body:'変更'}),/異なる内容/);
 assert.throws(()=>importNote(original,{...input,consentConfirmed:false}),/同意/);
 const conflict=importNote({...original,trialUsers:9},input).org;assert.equal(conflict.trialUsers,9);assert.equal(conflict.meetingNotes[0].facts[0].status,'pending');
 const n=a.org.meetingNotes[0];const undone=resolveFact(a.org,{noteId:n.id,index:0,action:'undo'});assert.equal(undone.trialUsers,null);assert.equal(undone.meetingNotes[0].history.length,5);
 assert.throws(()=>resolveFact({...a.org,trialUsers:99},{noteId:n.id,index:0,action:'undo'}),/変わって/);
});
test('否定・範囲・単位・複数の根拠は確認待ち、欠損値をゼロにしない',()=>{
 for(const body of ['試用人数は12人ではありません。','試用人数は10〜20人','希望数は20箱で確定です。','試用人数は12人で確定です。\n試用人数は15人で確定です。']){const facts=extractFacts(body);assert.ok(facts.every(f=>!f.explicit));assert.equal(importNote(org(),{...input,body}).org.trialUsers,null);}
 assert.equal(extractFacts('議題だけです').length,0);
});
test('議事録保存はrevision競合で二重反映せず、専用操作以外の履歴上書きを拒否',async t=>{
 const {store,revision}=await setup(t);const first=await writeMeetingNote(store,{...input,orgId:org().id,revision,action:'import'});await assert.rejects(writeMeetingNote(store,{...input,orgId:org().id,revision,action:'import'}),/再読み込み/);
 const saved=JSON.parse((await store.doc('workspace')).body);assert.equal(saved.orgSales[0].meetingNotes.length,1);assert.equal((await writeMeetingNote(store,{...input,orgId:org().id,revision:first.revision,action:'import'})).duplicate,true);
 assert.throws(()=>assertMeetingRecordsRetained(saved,{...saved,orgSales:[{...saved.orgSales[0],meetingNotes:[]}]}),/専用/);assert.throws(()=>assertMeetingRecordsRetained(saved,{...saved,orgSales:[{...saved.orgSales[0],deletedAt:new Date().toISOString()}]}),/議事録/);
});
