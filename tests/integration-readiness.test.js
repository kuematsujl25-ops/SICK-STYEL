import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createStore} from '../lib/store.js';
import {withRuntime} from '../lib/runtime.js';
import {encrypt} from '../lib/security.js';
import * as amazon from '../integrations/amazon.js';
import * as instagram from '../integrations/instagram.js';
import {connectionReadiness,selectAmazonSales,syncMessage} from '../public/integration-status.js';
import {registrationPlan} from '../scripts/lib/integration-plan.js';
const stamp='2026-10-18T00:00:00Z';
const status={configured:true,connected:true,cache:{syncVerified:true,syncedAt:stamp,salesSyncedAt:stamp,month:'2026-10',monthSales:5000}};
test('stored authorization is not a successful connection',()=>assert.equal(connectionReadiness({configured:true,connected:true},'amazon').state,'sync_unverified'));
test('unconfigured service is authentication pending',()=>assert.equal(connectionReadiness({configured:false,connected:false},'instagram').state,'awaiting_auth'));
test('expired Instagram requires reauthorization even with old data',()=>assert.equal(connectionReadiness({...status,expiresAt:1},'instagram').state,'awaiting_auth'));
test('verified external reads permit connected label',()=>assert.equal(connectionReadiness(status,'amazon').state,'connected'));
test('partial failure cannot be labelled connected',()=>assert.equal(connectionReadiness({...status,cache:{...status.cache,salesError:'network'}},'amazon').state,'sync_unverified'));
test('legacy cache without proof remains unverified',()=>assert.equal(connectionReadiness({...status,cache:{syncedAt:stamp}},'amazon').state,'sync_unverified'));
test('API and CSV/manual figures are never added',()=>assert.equal(selectAmazonSales(status,[{date:'2026-10-01',sales:5000}],'2026-10').value,5000));
test('previous month API data cannot replace this month manual data',()=>assert.deepEqual(selectAmazonSales(status,[{date:'2026-11-01',sales:300}],'2026-11'),{value:300,source:'manual',syncedAt:null,stale:false}));
test('no values is missing, not measured zero',()=>assert.equal(selectAmazonSales(null,[],'2026-10').value,null));
test('observed zero remains measured zero',()=>assert.equal(selectAmazonSales({...status,cache:{...status.cache,monthSales:0}},[],'2026-10').value,0));
test('old cache without Sales timestamp is not a verified API value',()=>assert.equal(selectAmazonSales({...status,cache:{month:'2026-10',monthSales:100}},[],'2026-10').source,'missing'));
test('stale API value retains source and failure marker',()=>assert.equal(selectAmazonSales({...status,cache:{...status.cache,salesError:'fail'}},[],'2026-10').stale,true));
test('partial result is not announced as successful sync',()=>assert.match(syncMessage({cache:{syncVerified:false}}),/同期未検証/));
test('monthly missing metric is null rather than false zero',()=>assert.deepEqual(amazon.monthlyMetrics([{date:'2026-10-01',sales:null,orders:0}],'2026-10'),{monthSales:null,monthOrders:0}));
test('empty monthly result stays unacquired',()=>assert.equal(amazon.monthlyMetrics([],'2026-10').monthSales,null));
test('foreign currency is not reported as yen',()=>assert.equal(amazon.parseMetrics([{interval:'2026-10-01',totalSales:{amount:'500',currencyCode:'USD'}}])[0].sales,null));
test('invalid date and negative counts are not accepted',()=>{assert.equal(amazon.parseMetrics([{interval:'2026-02-31'}]).length,0);assert.equal(amazon.parseMetrics([{interval:'2026-10-01',orderCount:-1}])[0].orders,null)});
test('blank monetary amount stays unacquired',()=>assert.equal(amazon.parseMetrics([{interval:'2026-10-01',totalSales:{amount:'',currencyCode:'JPY'}}])[0].sales,null));
async function fixture(t){
 const dir=await mkdtemp(path.join(tmpdir(),'ss-issue2-'));const store=await createStore({DATA_DIR:dir});const real=global.fetch;
 t.after(async()=>{global.fetch=real;store.close();await rm(dir,{recursive:true,force:true});});
 const env={AMAZON_LWA_CLIENT_ID:'fixture-client',AMAZON_LWA_CLIENT_SECRET:'fixture-secret',AMAZON_REFRESH_TOKEN:'fixture-refresh',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:'https://example.workers.dev'};
 return {store,env};
}
function mockAmazon({salesFail=false,ordersFail=false,malformed=false,currency='JPY'}={}){
 global.fetch=async(url,options={})=>{const u=new URL(url);if(u.hostname==='api.amazon.com'){assert.equal(options.method,'POST');return Response.json({access_token:'fixture-access'});}assert.equal(u.hostname,'sellingpartnerapi-fe.amazon.com');assert.equal(options.method,undefined,'SP-API reads only');
 if(u.pathname.includes('orderMetrics'))return salesFail?Response.json({errors:[{code:'Unauthorized'}]},{status:403}):Response.json({payload:[{interval:'2026-10-16',totalSales:{amount:'5000',currencyCode:currency},orderCount:2,unitCount:2}]});
 if(u.pathname.includes('/orders'))return ordersFail?Response.json({errors:[{code:'QuotaExceeded'}]},{status:429}):Response.json(malformed?{}:{orders:[{orderId:'fixture-order',fulfillment:{fulfillmentStatus:'UNSHIPPED'}}]});
 throw Error('Unexpected external destination');};
}
test('Sales failure across month boundary preserves original sales month and timestamp',async t=>{const {store,env}=await fixture(t);await withRuntime(env,async()=>{mockAmazon();const first=await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));mockAmazon({salesFail:true});const next=await amazon.sync(store,new Date('2026-11-01T05:00:00Z'));assert.equal(next.month,'2026-10');assert.equal(next.monthSales,5000);assert.equal(next.salesSyncedAt,first.salesSyncedAt);assert.equal(next.salesPeriod.start,first.salesPeriod.start);assert.notEqual(next.ordersPeriod.start,first.ordersPeriod.start);assert.equal(next.syncVerified,false);assert.ok(next.salesError);assert.equal(next.syncedAt,first.syncedAt);assert.equal((await amazon.safeStatus(store)).readiness.state,'sync_unverified');});});
test('Orders failure retains old orders period and marks it stale',async t=>{const {store,env}=await fixture(t);await withRuntime(env,async()=>{mockAmazon();const first=await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));mockAmazon({ordersFail:true});const next=await amazon.sync(store,new Date('2026-10-17T05:00:00Z'));assert.deepEqual(next.orders,first.orders);assert.deepEqual(next.ordersPeriod,first.ordersPeriod);assert.ok(next.ordersError);assert.equal(next.syncVerified,false);assert.equal(next.ordersSyncedAt,first.ordersSyncedAt);});});
test('malformed Orders response is not false zero orders',async t=>{const {store,env}=await fixture(t);await withRuntime(env,async()=>{mockAmazon({malformed:true});const next=await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));assert.equal(next.orders,null);assert.ok(next.ordersError);assert.equal(next.syncVerified,false);});});
test('successful normal reads record separate Sales and Orders proofs',async t=>{const {store,env}=await fixture(t);await withRuntime(env,async()=>{mockAmazon();const next=await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));assert.equal(next.syncVerified,true);assert.ok(next.salesSyncedAt);assert.ok(next.ordersSyncedAt);assert.equal((await amazon.safeStatus(store)).readiness.state,'connected');});});
test('foreign currency result stays unverified even when Orders succeeds',async t=>{const {store,env}=await fixture(t);await withRuntime(env,async()=>{mockAmazon({currency:'USD'});const next=await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));assert.equal(next.monthSales,null);assert.equal(next.syncVerified,false);assert.ok(next.warnings.length)});});
test('Instagram authorization URL has exact origin callback and minimum Insights scopes',async t=>{const {store,env}=await fixture(t);await withRuntime({...env,INSTAGRAM_APP_ID:'123456',INSTAGRAM_APP_SECRET:'fixture-only'},async()=>{const u=new URL(await instagram.begin(store,'fixture-session'));assert.equal(u.origin,'https://www.instagram.com');assert.equal(u.searchParams.get('redirect_uri'),'https://example.workers.dev/api/instagram/callback');assert.deepEqual(u.searchParams.get('scope').split(','),['instagram_business_basic','instagram_business_manage_insights']);assert.ok(u.searchParams.get('state'));});});
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
test('registration plan omits all credential values',()=>{const p=registrationPlan({...config,vars:{...config.vars,INSTAGRAM_APP_SECRET:'must-not-appear'}},'instagram');assert.equal(p.appliesChanges,false);assert.equal(JSON.stringify(p).includes('must-not-appear'),false);assert.match(p.callback,/\/api\/instagram\/callback$/)});
test('Amazon self authorization does not require website app id',()=>{const p=registrationPlan(config,'amazon');assert.ok(!p.requiredNames.includes('AMAZON_APP_ID'));assert.deepEqual(p.optionalNames,['AMAZON_APP_ID'])});
test('preview is default and needs no terminal or auth',()=>{const r=spawnSync(process.execPath,['scripts/set-secrets.js','instagram'],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).appliesChanges,false)});
test('apply refuses noninteractive invocation before reading credentials',()=>{const r=spawnSync(process.execPath,['scripts/set-secrets.js','amazon','--apply'],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/ターミナル/)});
test('ambiguous flags cannot mutate secrets',()=>{const r=spawnSync(process.execPath,['scripts/set-secrets.js','amazon','--plan','--apply'],{encoding:'utf8'});assert.notEqual(r.status,0)});
test('unsafe callback origin is rejected',()=>assert.throws(()=>registrationPlan({...config,vars:{APP_ORIGIN:'http://localhost:3000'}},'instagram')));

test('Instagram profile without any Insights is not a verified sync',async t=>{const {store,env}=await fixture(t);await withRuntime({...env,INSTAGRAM_APP_ID:'123456',INSTAGRAM_APP_SECRET:'fixture-only'},async()=>{
 await store.put('instagram-private',{id:'123456',encrypted:encrypt({access:'fixture-access'}),expiresAt:Date.now()+30*86400000,issuedAt:Date.now(),granted:[]});
 global.fetch=async url=>{const u=new URL(url);assert.equal(u.hostname,'graph.instagram.com');if(u.pathname.endsWith('/insights'))return Response.json({error:{code:10}},{status:403});if(u.pathname.endsWith('/media'))return Response.json({data:[]});return Response.json({followers_count:100});};
 const cache=await instagram.sync(store);assert.equal(cache.followers,100);assert.equal(cache.account.reach,null);assert.equal(cache.syncVerified,false);assert.equal(cache.syncedAt,null);assert.ok(cache.warnings.length);assert.equal((await instagram.safeStatus(store)).readiness.state,'sync_unverified');
 });});
