import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewBatch,stagePreview,summarize} from '../tools/instagram-preview/model.js';
const sample=()=>JSON.parse(readFileSync(new URL('../tools/instagram-preview/sample.json',import.meta.url)));
const preview=b=>previewBatch(b,'demo_business','2026-10-31T10:00:00Z');
test('unique accounts; incomplete history and ambiguous invitations excluded; replay idempotent',()=>{
 const p=preview(sample()),l=stagePreview([],p);
 assert.equal(p.rows.filter(r=>r.reasons.length).length,2);
 assert.deepEqual(summarize(l,'2026-10').monthly,{new_dm:1,reply:1,zoom_invite:1});
 assert.deepEqual(stagePreview(l,p),l);
 assert.equal(l.length,4);assert.equal(l[0].source,'manual');assert.equal(l[0].coverage,'partial');
});
test('monthly replies differ from first-DM cohort; JST dates are retained',()=>{
 const b=sample();b.rangeStart='2026-09-01';b.events[0].date='2026-09-30';
 const s=summarize(stagePreview([],preview(b)),'2026-10');
 assert.deepEqual(s.monthly,{new_dm:0,reply:1,zoom_invite:1});assert.equal(s.cohort.size,0);
});
test('wrong account, invalid calendar dates, future capture, body, full coverage rejected',()=>{
 assert.throws(()=>previewBatch(sample(),'another_account'));
 for(const mutate of [b=>b.events[0].date='2026-02-30',b=>b.capturedAt='2027-01-01T00:00:00Z',b=>b.events[0].body='private text',b=>b.coverage='complete',b=>b.events[0].account='https://example.com',b=>b.events[0].date='2026-09-01']){
  const b=sample();mutate(b);assert.throws(()=>preview(b));
 }
});
test('unknown date, wrong direction, unverified and unproven first outbound stay pending',()=>{
 for(const mutate of [e=>e.date=null,e=>e.direction='inbound',e=>e.verified=false,e=>e.firstOutboundConfirmed=false]){
  const b=sample();b.events=[b.events[0]];mutate(b.events[0]);assert.equal(stagePreview([],preview(b)).length,0);
 }
});
test('case normalization dedupes; conflicting first date and mapping fail atomically',()=>{
 const b=sample(),l=stagePreview([],preview(b));b.events[0].account='@DEMO_CLUB_A';
 assert.equal(stagePreview(l,preview(b)).length,l.length);
 b.events[0].date='2026-10-01';assert.throws(()=>stagePreview(l,preview(b)));assert.equal(l[0].date,'2026-10-02');
 b.events[0].date='2026-10-02';b.events[0].party='org_example';assert.throws(()=>stagePreview(l,preview(b)));assert.equal(l[0].party,'');
});
test('zoom invitation never becomes appointment or touches salesKpiRecords',()=>{
 const l=stagePreview([],preview(sample()));assert.ok(!l.some(e=>e.type==='appointment'));assert.equal(l.filter(e=>e.type==='zoom_invite').length,1);
});
