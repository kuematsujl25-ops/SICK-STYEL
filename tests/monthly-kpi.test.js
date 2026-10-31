import {test} from 'node:test';
import assert from 'node:assert/strict';
import {computeKpi,day,renderKpi} from '../public/monthly-kpi.js';
import {validate,empty} from '../lib/domain.js';
import {retainKpiHistory,restoreKpiHistory} from '../lib/monthly-kpi.js';
let id=0;const e=(type,date,extra={})=>({id:String(++id),type,date,party:'example-org',deal:'',ref:'',channel:'unknown',amount:null,qty:null,title:'Synthetic evidence',createdAt:'2026-10-31T00:00:00Z',...extra});
const calc=r=>computeKpi(r,'2026-10','2026-10-31T14:59:59Z');
test('first-DM cohorts separate month activity; duplicate followups and replies count once',()=>{const rows=[e('dm','2026-09-29'),e('dm','2026-10-01'),e('reply','2026-10-02'),e('reply','2026-10-03'),e('zoom','2026-10-04'),e('order','2026-10-05',{deal:'a'})];const k=calc(rows);assert.equal(k.counts.dm,0);assert.equal(k.counts.reply,1);assert.equal(k.counts.order,1);assert.equal(k.rates[0].value,null);});
test('booking is not execution; repeat orders are cases but conversion counts unique parties',()=>{const rows=[e('dm','2026-10-01'),e('appointment','2026-10-02'),e('order','2026-10-04',{deal:'a'}),e('order','2026-10-06',{deal:'b'})];const k=calc(rows);assert.equal(k.counts.zoom,0);assert.equal(k.counts.order,2);assert.equal(k.rates[4].value,null);assert.equal(k.rates[5].value,100);});
test('void preserves evidence and restores measurement; date pairs and assumed LT distinct',()=>{const dm=e('dm','2026-10-01'),reply=e('reply','2026-10-05'),order=e('order','2026-10-20',{deal:'a',amount:100,channel:'direct'});const rows=[dm,reply,e('zoom','2026-10-05'),e('second','2026-10-17'),order,e('complete','2026-10-31')];assert.equal(calc(rows).lt.second.value,12);assert.equal(calc(rows).lt.zoom.value,4);assert.equal(calc(rows).revenue,100);rows.push(e('void','2026-10-20',{ref:order.id}));assert.equal(calc(rows).revenue,0);assert.equal(calc(rows).counts.order,0);});
test('missing coverage and missing amounts remain null, explicit zero remains zero',()=>{assert.equal(calc([]).revenue,null);assert.equal(calc([e('complete','2026-10-31')]).revenue,0);assert.equal(calc([e('complete','2026-10-31'),e('order','2026-10-30',{deal:'a',channel:'direct'})]).revenue,null);});
test('JST boundaries and future events',()=>{assert.equal(day('2026-09-30T15:00:00Z'),'2026-10-01');assert.equal(day('2026-09-30T14:59:59Z'),'2026-09-30');assert.equal(calc([e('dm','2026-11-01')]).counts.dm,0);});
test('schema round-trip, legacy migration, invalid dates, duplicate orders, history retention',()=>{const row=e('order','2026-10-01',{deal:'a'});const doc={...empty(),salesKpiRecords:[row]};assert.deepEqual(validate(JSON.parse(JSON.stringify(doc))).salesKpiRecords,[row]);const legacy=empty();delete legacy.salesKpiRecords;assert.deepEqual(validate(legacy).salesKpiRecords,[]);assert.throws(()=>validate({...doc,salesKpiRecords:[{...row,date:'2026-02-30'}]}));assert.throws(()=>validate({...doc,salesKpiRecords:[row,{...row,id:'duplicate'}]}));assert.throws(()=>retainKpiHistory(doc,empty()));retainKpiHistory(doc,validate(doc));});
test('escaping and rendering zero denominator and missingness',()=>{const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const html=renderKpi([e('dm','2026-10-01',{title:'<script>bad</script>'})],'2026-10',[],null,esc);assert.ok(html.includes('&lt;script>'));assert.ok(html.includes('算出不可'));assert.ok(html.includes('想定12日'));assert.ok(!html.includes('<script>bad'));});
test('shipping LT pairs each shipment by party and shipment ID across months',()=>{const rows=[e('sent','2026-09-01',{deal:'s1'}),e('arrived','2026-09-03',{deal:'s1'}),e('sent','2026-10-01',{deal:'s2'}),e('arrived','2026-10-03',{deal:'s2'}),e('sent','2026-10-02',{deal:'s3'}),e('arrived','2026-10-06',{deal:'s3'}),e('arrived','2026-10-07',{deal:'unpaired'})];assert.deepEqual(calc(rows).lt.shipping,{count:2,value:3});assert.throws(()=>validate({...empty(),salesKpiRecords:[e('sent','2026-10-01')]}));});
test('unknown sales channel cannot establish zero direct revenue',()=>{assert.equal(calc([e('complete','2026-10-31'),e('order','2026-10-30',{deal:'a',amount:100,channel:'unknown'})]).revenue,null);});

test('older backup restores unrelated data while retaining current immutable KPI records',()=>{const r=e('dm','2026-10-01');const current={...empty(),salesKpiRecords:[r]};const restored=validate(restoreKpiHistory(current,empty()));assert.deepEqual(restored.salesKpiRecords,[r]);retainKpiHistory(current,restored);assert.equal(restoreKpiHistory(current,{...empty(),salesKpiRecords:[{...r,title:'older value'}]}).salesKpiRecords[0].title,r.title);});

test('JST server date boundary applies to activities and cancellations',async()=>{
 const {validateKpi}=await import('../lib/monthly-kpi.js');
 const dm=e('dm','2026-10-31'),cancel=e('void','2026-11-01',{ref:dm.id});
 assert.throws(()=>validateKpi([dm],'2026-10-30T14:59:59Z'),/今日以前/);
 assert.doesNotThrow(()=>validateKpi([dm],'2026-10-30T15:00:00Z'));
 assert.throws(()=>validateKpi([dm,cancel],'2026-10-31T14:59:59Z'),/今日以前/);
 assert.doesNotThrow(()=>validateKpi([dm,cancel],'2026-10-31T15:00:00Z'));
 assert.equal(computeKpi([dm,cancel],'2026-10','2026-10-31T14:59:59Z').counts.dm,1);
 assert.equal(computeKpi([dm,cancel],'2026-10','2026-10-31T15:00:00Z').counts.dm,0);
 assert.throws(()=>validateKpi([dm,{...cancel,date:'2026-10-30'}],'2026-10-31T15:00:00Z'),/元の活動日以後/);
});
test('reversed and incomplete history remains saveable but visibly unresolved after attestation',()=>{
 const rows=[e('dm','2026-10-10'),e('reply','2026-10-09'),e('zoom','2026-10-08'),e('complete','2026-10-31')];
 assert.doesNotThrow(()=>validate({...empty(),salesKpiRecords:rows}));
 const k=calc(rows);assert.equal(k.complete,true);assert.equal(k.usable,false);assert.ok(k.quality.issues.some(q=>q.code.includes('より前')));
 const esc=s=>String(s??'');const html=renderKpi(rows,'2026-10',[],null,esc);
 assert.match(html,/自己申告/);assert.match(html,/算出保留（品質確認）/);assert.match(html,/未測定（有効な日付ペア0組）/);
 const incomplete=[e('second','2026-10-17')];assert.doesNotThrow(()=>validate({...empty(),salesKpiRecords:incomplete}));assert.ok(calc(incomplete).quality.issues.some(q=>q.code.includes('返信日が未記録')));
});
test('one recorded stage never establishes legacy or monthly stage completeness',()=>{
 const rows=[e('reply','2026-09-01'),e('complete','2026-10-31')];
 const k=computeKpi(rows,'2026-10','2026-10-31T14:59:59Z',[{id:'example-org'}]);
 assert.equal(k.quality.legacyMissingDm,1);assert.equal(k.usable,false);assert.equal(k.revenue,null);
 assert.equal(k.quality.stages.find(s=>s.type==='reply').recorded,0);
 assert.match(renderKpi(rows,'2026-10',[{id:'example-org'}],null,s=>String(s??'')),/未発生と未入力は判別できず/);
});
