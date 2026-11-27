import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInstagramReview,readInstagramReview,saveInstagramReview} from '../lib/instagram-review.js';
import {reviewContent} from '../public/instagram-review.js';
const now=Date.parse('2026-01-02T00:01:00Z');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const input=()=>({version:1,source:'metricool',account:'@Sample',observedAt:'2026-01-02T09:00:00+09:00',
 analysis:{from:'2025-12-03',to:'2026-01-01',reelCount:0,medianViews:null,medianReach:null,saves:0,shares:null,findings:['<script>bad</script>'],recommendations:[]},
 planner:{from:'2026-01-02T09:00:00+09:00',to:'2026-02-01T09:00:00+09:00',posts:[{id:'p1',at:'2026-01-02T20:00:00+09:00',type:'reel',caption:'<img src=x>',url:'https://app.metricool.com/evolution/web?example=1'}]}});
test('valid import distinguishes zero, missing and timezone; outputs escaped content',()=>{
 const v=validateInstagramReview(input(),now);assert.equal(v.account,'sample');assert.equal(v.planner.posts[0].at,'2026-01-02T11:00:00.000Z');
 assert.equal(v.analysis.reelCount,0);assert.equal(v.analysis.medianViews,null);
 const {analysis,planner}=v; const html=reviewContent({snapshot:{...v,analysis:{...analysis,observedAt:v.observedAt},planner:{...planner,observedAt:v.observedAt}}},esc,now);
 assert.match(html,/20:00 JST/);assert.match(html,/未取得/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img /);
 assert.match(reviewContent(null,esc),/未取得/);
 const stale=reviewContent({snapshot:{...v,analysis:{...analysis,observedAt:v.observedAt},planner:{...planner,observedAt:v.observedAt}}},esc,now+2*86_400_000);
 assert.match(stale,/結果未確認/);assert.match(stale,/24時間以上前/);
});
test('strict format rejects invalid dates, duplicates, unknown keys and lookalike URLs',()=>{
 for(const change of [
 s=>s.analysis.from='2025-12-32',s=>s.planner.posts.push({...s.planner.posts[0]}),
 s=>s.planner.posts[0].url='https://app.metricool.com.evil.test/a',
 s=>s.planner.posts[0].url='https://bad:token@app.metricool.com/a',
 s=>s.planner.posts[0].at='2026-01-02T20:00:00',
 s=>s.planner.posts[0].at='2026-01-02T24:00:00Z',
 s=>s.token='no',s=>s.analysis.reelCount=-1,s=>s.observedAt='2028-01-02T00:01:00Z'
 ]){const v=input();change(v);assert.throws(()=>validateInstagramReview(v,now));}
});
test('merge preserves missing sections, rejects older snapshots, account switches and conflicting revisions',async()=>{
 let row;
 const store={doc:async()=>row,query:async(sql,params)=>{
  if(sql.startsWith('INSERT')){if(row)return [];row={revision:0,body:params[1]};}
  else{if(!row||row.revision!==params[2])return [];row={revision:row.revision+1,body:params[0]};}
  return [{revision:row.revision}];
 }};
 assert.deepEqual(await readInstagramReview(store),{snapshot:null,revision:null});
 await saveInstagramReview(store,{snapshot:input(),revision:null});
 const second=input();second.observedAt='2026-01-02T10:00:00+09:00';second.analysis=null;second.planner.posts=[];
 const result=await saveInstagramReview(store,{snapshot:second,revision:0});
 assert.equal(result.snapshot.analysis.reelCount,0);assert.deepEqual(result.snapshot.planner.posts,[]);
 await assert.rejects(saveInstagramReview(store,{snapshot:input(),revision:0}),{status:409});
 await assert.rejects(saveInstagramReview(store,{snapshot:input(),revision:1}),{status:409});
 const wrong=input();wrong.account='other';
 await assert.rejects(saveInstagramReview(store,{snapshot:wrong,revision:1}),{status:400});
});
