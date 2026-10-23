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
 await withRuntime(env,async()=>{await sync(store,{fetcher,now});assert.equal((await status(store)).job.status,'pending');await sync(store,{fetcher,now});assert.equal((await status(store)).rows.length,1);cost=20;await sync(store,{fetcher,now});await sync(store,{fetcher,now});const s=await status(store);assert.equal(s.rows.length,1);assert.equal(s.rows[0].adCost,20);assert.equal(requests,2);});await withRuntime({...env,AMAZON_ADS_PROFILE_ID:'2'},async()=>{assert.equal((await status(store)).connected,false);await assert.rejects(sync(store,{fetcher,now}),/プロフィールが変わりました/);});
 assert.equal(JSON.parse((await store.doc('amazonads-reports')).body).history[1].previous[0].adCost,10);assert.ok(calls.every(([url,m])=>m==='GET'||url.includes('/auth/')||url.endsWith('/reporting/reports')));
});
test('Ads作成応答不明は再要求停止、取得先はHTTPS S3だけ、失敗を成功にしない',async t=>{
 const store=await setup(t);let requests=0;const fetcher=async(url)=>{if(String(url).includes('/auth/'))return Response.json({access_token:'mock'});if(String(url).endsWith('/v2/profiles'))return Response.json([{profileId:1,countryCode:'JP',currencyCode:'JPY',timezone:'Asia/Tokyo',accountInfo:{type:'seller'}}]);requests++;throw Error('network');};
 await withRuntime(env,async()=>{await assert.rejects(sync(store,{fetcher,now}),/結果が不明/);await assert.rejects(sync(store,{fetcher,now}),/結果確認/);assert.equal((await status(store)).lastSuccess,null);});assert.equal(requests,1);
});
