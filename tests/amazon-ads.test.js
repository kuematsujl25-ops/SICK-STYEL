import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {gzipSync} from 'node:zlib';import {createStore} from '../lib/store.js';import {withRuntime} from '../lib/runtime.js';import {sync,status,normalizeReport,reportingWindow} from '../integrations/amazon-ads.js';import {reconcileAds} from '../public/ads-reconcile.js';
async function setup(t){const dir=await mkdtemp(tmpdir()+'/ss-ads-'),store=await createStore({DATA_DIR:dir});t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
const env={AMAZON_ADS_CLIENT_ID:'mock',AMAZON_ADS_CLIENT_SECRET:'mock',AMAZON_ADS_REFRESH_TOKEN:'mock',AMAZON_ADS_PROFILE_ID:'1'};
const now=new Date('2026-10-23T16:00:00Z');
test('Ads未認可はSP-APIに依存せず未接続、欠損はnull、期間は日本時間',async t=>{
 const store=await setup(t);await withRuntime({},async()=>{assert.equal((await status(store)).connected,false);await assert.rejects(sync(store),/専用/);});assert.deepEqual(reportingWindow(now),{start:'2026-09-23',end:'2026-10-23'});
 const [row]=normalizeReport([{date:'2026-10-23',campaignId:1,cost:0}],{profileId:'1',windowDays:7,start:'2026-10-01',end:'2026-10-23'});assert.equal(row.adCost,0);assert.equal(row.attributedSales,null);
 assert.throws(()=>normalizeReport([{date:'2026-02-30',campaignId:1}],{profileId:'1',windowDays:7,start:'2026-01-01',end:'2026-12-31'}),/不正/);
 assert.equal(reconcileAds([{platform:'Amazon',periodStart:'2026-10-01',periodEnd:'2026-10-31'}],[row]).conflicts,1);
});
test('Ads非同期レポートは日次キーで上書き、遅延改定と過去履歴を保持、広告配信APIを呼ばない',async t=>{
 const store=await setup(t);let requests=0,cost=10;const calls=[];
 const fetcher=async(url,opt={})=>{url=String(url);calls.push([url,opt.method||'GET']);if(url.includes('/auth/'))return Response.json({access_token:'mock'});if(url.endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);if(url.endsWith('/reporting/reports')){requests++;return Response.json({reportId:'example'});}if(url.includes('/reporting/reports/'))return Response.json({status:'COMPLETED',url:'https://example.s3.ap-northeast-1.amazonaws.com/example'});return new Response(gzipSync(JSON.stringify([{date:'2026-10-23',campaignId:1,cost,sales7d:100}])));};
 await withRuntime(env,async()=>{await sync(store,{fetcher,now});assert.equal((await status(store)).job.status,'pending');await sync(store,{fetcher,now});assert.equal((await status(store)).rows.length,1);cost=20;await sync(store,{fetcher,now});await sync(store,{fetcher,now});const s=await status(store);assert.equal(s.rows.length,1);assert.equal(s.rows[0].adCost,20);assert.equal(requests,2);});await withRuntime({...env,AMAZON_ADS_PROFILE_ID:'2'},async()=>{assert.equal((await status(store)).connected,false);assert.deepEqual((await status(store)).rows,[]);assert.equal((await status(store)).lastSuccess,null);await assert.rejects(sync(store,{fetcher,now}),/プロフィールが変わりました/);});
 assert.equal(JSON.parse((await store.doc('amazonads-reports')).body).history[1].previous[0].adCost,10);assert.ok(calls.every(([url,m])=>m==='GET'||url.includes('/auth/')||url.endsWith('/reporting/reports')));
});
test('Ads作成応答不明は再要求停止、取得先はHTTPS S3だけ、失敗を成功にしない',async t=>{
 const store=await setup(t);let requests=0;const fetcher=async(url)=>{if(String(url).includes('/auth/'))return Response.json({access_token:'mock'});if(String(url).endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);requests++;throw Error('network');};
 await withRuntime(env,async()=>{await assert.rejects(sync(store,{fetcher,now}),/結果が不明/);await assert.rejects(sync(store,{fetcher,now}),/結果確認/);assert.equal((await status(store)).lastSuccess,null);});assert.equal(requests,1);
});

test('Adsの明示的429拒否は待機後に再試行でき、通信結果不明とは区別する',async t=>{
 const store=await setup(t);let requests=0;
 const fetcher=async url=>{if(String(url).includes('/auth/'))return Response.json({access_token:'mock'});if(String(url).endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);requests++;return requests===1?new Response(null,{status:429}):Response.json({reportId:'retry-example'});};
 await withRuntime(env,async()=>{await assert.rejects(sync(store,{fetcher,now}),/HTTP 429/);assert.equal((await status(store)).job,null);await assert.rejects(sync(store,{fetcher,now}),/再試行待ち/);assert.equal(requests,1);await sync(store,{fetcher,now:new Date(now.getTime()+61000)});assert.equal((await status(store)).job.status,'pending');assert.equal(requests,2);});
});

test('Ads終端FAILEDは既存実績を保持し待機後に次の要求を許可する',async t=>{
 const store=await setup(t);let requests=0;
 const fetcher=async url=>{if(String(url).includes('/auth/'))return Response.json({access_token:'mock'});if(String(url).endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);if(String(url).endsWith('/reporting/reports')){requests++;return Response.json({reportId:'example-'+requests});}return Response.json({status:'FAILED'});};
 await withRuntime(env,async()=>{await sync(store,{fetcher,now});await assert.rejects(sync(store,{fetcher,now}),/生成失敗/);assert.equal((await status(store)).job,null);assert.equal((await status(store)).lastSuccess,null);await assert.rejects(sync(store,{fetcher,now}),/再試行待ち/);assert.equal(requests,1);await sync(store,{fetcher,now:new Date(now.getTime()+61000)});assert.equal(requests,2);assert.equal((await status(store)).job.status,'pending');});
});
test('Ads425は既存レポートIDで進捗を確認し、不正なID応答は再要求しない',async t=>{
 const store=await setup(t),id='00000000-0000-4000-8000-000000000001';let requests=0,polls=0;
 const fetcher=async url=>{if(String(url).includes('/auth/'))return Response.json({access_token:'mock'});if(String(url).endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);if(String(url).endsWith('/reporting/reports')){requests++;return Response.json({detail:'The request is a duplicate of : '+id},{status:425});}assert.ok(String(url).endsWith('/'+id));polls++;return Response.json({status:'PENDING'});};
 await withRuntime(env,async()=>{await sync(store,{fetcher,now});await sync(store,{fetcher,now});assert.equal(requests,1);assert.equal(polls,1);assert.equal((await status(store)).job.status,'pending');});
 const other=await setup(t);await withRuntime(env,async()=>{const invalid=async(url,opt)=>String(url).endsWith('/reporting/reports')?Response.json({detail:'unknown result'},{status:425}):fetcher(url,opt);await assert.rejects(sync(other,{fetcher:invalid,now}),/結果が不明/);await assert.rejects(sync(other,{fetcher:invalid,now}),/結果確認/);});
});

const reportRows=(n,cost=10)=>Array.from({length:n},(_,i)=>({date:'2026-10-23',campaignId:i+1,campaignName:'ダミー広告'.repeat(12),cost,sales7d:100}));
const job={id:'capacity-report',status:'pending',start:'2026-09-23',end:'2026-10-23',windowDays:7,profileId:'1'};
const fakeReport=rows=>async url=>{
 url=String(url);
 if(url.includes('/auth/'))return Response.json({access_token:'mock'});
 if(url.endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);
 if(url.endsWith('/reporting/reports'))return Response.json({reportId:'capacity-report'});
 if(url.includes('/reporting/reports/'))return Response.json({status:'COMPLETED',url:'https://example.s3.ap-northeast-1.amazonaws.com/capacity'});
 return new Response(gzipSync(JSON.stringify(rows)));
};
async function seedCapacity(store){
 const rows=normalizeReport(reportRows(700),job);
 const history=Array.from({length:3},(_,i)=>({at:'2026-10-2'+i+'T00:00:00Z',reportId:'old-'+i,start:job.start,end:job.end,previous:rows}));
 const state={rows,history,job:{...job},profileVerified:'1',lastSuccess:'2026-10-22T00:00:00Z',error:null};
 assert.ok(Buffer.byteLength(JSON.stringify(state))<1_500_000);
 assert.ok(Buffer.byteLength(JSON.stringify({...state,history:[...history,history[0]]}))>1_500_000);
 await store.put('amazonads-reports',state);return state;
}
const archives=store=>store.query("SELECT name,body FROM ss_documents WHERE name LIKE 'amazonads-reports-history/%' ORDER BY name");
test('Ads履歴容量を超えても全履歴を別文書へ保全し、次回同期も完了する',async t=>{
 const store=await setup(t),before=await seedCapacity(store);
 await withRuntime(env,async()=>{
  await sync(store,{fetcher:fakeReport(reportRows(700,20)),now});
  let current=JSON.parse((await store.doc('amazonads-reports')).body),saved=await archives(store);
  assert.equal(current.job,null);assert.equal(current.rows[0].adCost,20);assert.ok(saved.length>0);
  assert.ok(Buffer.byteLength(JSON.stringify(current))<=1_500_000);
  const all=[...saved.map(r=>JSON.parse(r.body).snapshot),...current.history];
  for(const old of before.history)assert.deepEqual(all.find(x=>x.reportId===old.reportId),old);
  assert.deepEqual(all.find(x=>x.reportId==='capacity-report').previous,before.rows);
  await sync(store,{fetcher:fakeReport(reportRows(700,30)),now});
  await sync(store,{fetcher:fakeReport(reportRows(700,30)),now:new Date(now.getTime()+1000)});
  assert.equal((await status(store)).rows[0].adCost,30);assert.equal((await status(store)).job,null);
  current=JSON.parse((await store.doc('amazonads-reports')).body);saved=await archives(store);
  assert.equal(saved.length+current.history.length,5);
 });
});
test('Ads保全トランザクション失敗は履歴移動も現在値更新も戻し、同じジョブで再試行できる',async t=>{
 const store=await setup(t),before=await seedCapacity(store),transaction=store.transaction;
 store.transaction=commands=>transaction([...commands.slice(0,-1),['INSERT INTO nonexistent_table VALUES (1)'],commands.at(-1)]);
 await withRuntime(env,async()=>{
  await assert.rejects(sync(store,{fetcher:fakeReport(reportRows(700,20)),now}));
  let current=JSON.parse((await store.doc('amazonads-reports')).body);
  assert.deepEqual(current.rows,before.rows);assert.deepEqual(current.history,before.history);assert.deepEqual(current.job,before.job);assert.equal((await archives(store)).length,0);
  store.transaction=transaction;await sync(store,{fetcher:fakeReport(reportRows(700,20)),now});
  assert.equal((await status(store)).job,null);assert.equal((await status(store)).rows[0].adCost,20);
 });
});
test('Ads同時更新に負けた処理は履歴アーカイブを残さず新しいデータを上書きしない',async t=>{
 const store=await setup(t),before=await seedCapacity(store),transaction=store.transaction;
 store.transaction=async commands=>{await store.put('amazonads-reports',{...before,error:'concurrent update'});return transaction(commands);};
 await withRuntime(env,async()=>{await assert.rejects(sync(store,{fetcher:fakeReport(reportRows(700,20)),now}),/広告同期中/);});
 assert.equal((await archives(store)).length,0);const current=JSON.parse((await store.doc('amazonads-reports')).body);
 assert.equal(current.error,'concurrent update');assert.deepEqual(current.rows,before.rows);assert.deepEqual(current.history,before.history);
});
test('Ads現在値自体が上限超過なら以前の実績・履歴・保留ジョブを保持する',async t=>{
 const store=await setup(t),before=await seedCapacity(store);
 await withRuntime(env,async()=>{await assert.rejects(sync(store,{fetcher:fakeReport(reportRows(4000)),now}),/保存容量/);});
 const current=JSON.parse((await store.doc('amazonads-reports')).body);
 assert.deepEqual(current.rows,before.rows);assert.deepEqual(current.history,before.history);assert.deepEqual(current.job,before.job);assert.equal((await archives(store)).length,0);
});
test('Ads30件を超えた履歴も削除せず保全する',async t=>{
 const store=await setup(t),history=Array.from({length:30},(_,i)=>({at:'2026-10-23T00:00:00Z',reportId:'small-'+i,previous:[]}));
 await store.put('amazonads-reports',{rows:[],history,job:{...job},profileVerified:'1',error:null});
 await withRuntime(env,async()=>{await sync(store,{fetcher:fakeReport([]),now});});
 const current=JSON.parse((await store.doc('amazonads-reports')).body),saved=await archives(store);
 assert.equal(current.history.length,30);assert.equal(saved.length,1);assert.deepEqual(JSON.parse(saved[0].body).snapshot,history[0]);
});
