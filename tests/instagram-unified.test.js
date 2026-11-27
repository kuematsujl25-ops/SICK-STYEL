import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {withRuntime} from '../lib/runtime.js';
import {decrypt} from '../lib/security.js';
import {begin,config,connect,disconnect,safeStatus,sync} from '../integrations/instagram.js';
import {exchangeUnified,instagramCallbackDiagnostic,unifiedGraph,unifiedSettings} from '../integrations/instagram-unified.js';

const env={INSTAGRAM_LOGIN_MODE:'unified',INSTAGRAM_UNIFIED_APP_ID:'123456',INSTAGRAM_UNIFIED_APP_SECRET:'fixture-app-secret',INSTAGRAM_UNIFIED_CONFIG_ID:'223456',INSTAGRAM_UNIFIED_BUSINESS_ID:'323456',INSTAGRAM_UNIFIED_USERNAME:'sample_account',APP_ORIGIN:'https://example.com',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),INSTAGRAM_ENABLE_MESSAGING:'true'};
const expiry=()=>Math.floor(Date.now()/1000)+86400;
const fake=(opts={})=>async (url,req)=>{
 const u=new URL(url);assert.equal(u.hostname,'graph.facebook.com');
 assert.equal(req.method,'GET');
 if(u.pathname.endsWith('/oauth/access_token')){
  assert.equal(u.searchParams.get('redirect_uri'),'https://example.com/api/instagram/callback');
  return {access_token:'fixture-user-token'};
 }
 if(u.pathname.endsWith('/debug_token'))return {data:{is_valid:true,app_id:'123456',scopes:['instagram_basic','instagram_manage_insights'],expires_at:expiry(),...opts.debug}};
 if(u.pathname.endsWith('/me'))return {client_business_id:opts.business||'323456'};
 if(u.pathname.endsWith('/assigned_instagram_accounts'))return opts.accounts||{data:[{id:'654321',username:'sample_account'}]};
 if(u.pathname.endsWith('/media'))return {data:[{id:'987654',media_product_type:'REELS',caption:'Test reel'}]};
 if(u.pathname.endsWith('/insights'))return {data:[{name:'reach',total_value:{value:0}}]};
 assert.equal(u.pathname,'/v27.0/654321');
 return {id:'654321',username:'sample_account',followers_count:123};
};
const expects=unifiedSettings(env);
test('Unified never configures without pinned business and account or HTTPS origin',()=>{
 assert.ok(expects);
 for(const [key,value] of [['APP_ORIGIN','http://example.com'],['APP_ORIGIN','https://example.com/path'],['INSTAGRAM_UNIFIED_BUSINESS_ID',''],['INSTAGRAM_UNIFIED_USERNAME','@sample_account']])assert.equal(unifiedSettings({...env,[key]:value}),null);
 assert.throws(()=>unifiedGraph('654321/subscribed_apps','tok',{},fake()),/不正/);
});

test('Unified refuses wrong portfolio, account, multiple assets, extra rights, and unbounded expiry',async()=>{
 for(const failure of [
  {debug:{app_id:'999999'}},{debug:{scopes:['instagram_basic']}},
  {debug:{scopes:['instagram_basic','instagram_manage_insights','instagram_manage_messages']}},
  {debug:{expires_at:0}},{debug:{expires_at:expiry()+365*86400}},{debug:{data_access_expires_at:1}},
  {business:'456789'},{accounts:{data:[{id:'654321',username:'other'}]}},
  {accounts:{data:[{id:'654321',username:'sample_account'},{id:'777777',username:'other'}]}},
  {accounts:{data:[{id:'654321',username:'sample_account'}],paging:{next:'https://example.com'}}},
 ])await assert.rejects(exchangeUnified(expects,'fixture-code',fake(failure)));
});

test('checks every assignment page without using Meta paging URLs or accepting any other account',async()=>{
 const normal=fake();
 const correct={id:'654321',username:'@SAMPLE_ACCOUNT'};
 const run=(pages)=>async(u,req)=>{
  if(!u.pathname.endsWith('/assigned_instagram_accounts'))return normal(u,req);
  assert.equal(u.origin,'https://graph.facebook.com');
  assert.equal(u.searchParams.has('access_token'),false);
  assert.equal(req.headers.Authorization,'Bearer fixture-user-token');
  const page=u.searchParams.get('after')===null?0:u.searchParams.get('after')==='opaque_A'?1:2;
  return pages[page];
 };
 const paging={next:'https://example.com/?access_token=must-not-follow',cursors:{after:'opaque_A'}};
 const result=await exchangeUnified(expects,'fixture-code',run([{data:[correct],paging},{data:[]}]));
 assert.equal(result.id,'654321');assert.equal(result.username,'sample_account');
 await assert.rejects(exchangeUnified(expects,'fixture-code',run([{data:[correct],paging},{data:[{id:'999999',username:'other'}]}])),{step:'account_multiple'});
 await assert.rejects(exchangeUnified(expects,'fixture-code',run([{data:[correct],paging},{data:[],paging}])),{step:'account_paging'});
 await assert.rejects(exchangeUnified(expects,'fixture-code',run([{data:[{id:Number.MAX_SAFE_INTEGER+1,username:'sample_account'}]}])),{step:'account_shape'});
 await assert.rejects(exchangeUnified(expects,'fixture-code',run([{data:[{id:'654321',username:'other'}]}])),{step:'account_identity'});
});

test('missing assigned handle is checked only for the sole assigned ID and still fails closed',async()=>{
 let calls=0;
 const run=(accounts,profile)=>async(u,req)=>{
  if(u.pathname!=='/v27.0/654321')return fake({accounts})(u,req);
  calls++;
  assert.equal(u.origin,'https://graph.facebook.com');
  assert.equal(u.searchParams.get('fields'),'id,username');
  assert.equal(req.headers.Authorization,'Bearer fixture-user-token');
  if(profile instanceof Error)throw profile;
  return profile;
 };
 const accounts={data:[{id:'654321'}]};
 const original={id:'654321',username:'sample_account'};
 assert.equal((await exchangeUnified(expects,'fixture-code',run(accounts,original))).username,original.username);
 for(const profile of [{...original,id:'999999'},{...original,username:'other'},{id:'654321'}])
  await assert.rejects(exchangeUnified(expects,'fixture-code',run(accounts,profile)),{step:'account_profile_identity'});
 await assert.rejects(exchangeUnified(expects,'fixture-code',run(accounts,new Error('test provider detail'))),{step:'account_profile_lookup'});
 assert.equal(calls,5);
 for(const [rows,step] of [
  [[{id:'654321',username:'other'}],'account_identity'],
  [[{id:'654321'},{id:'999999'}],'account_multiple'],
  [[{id:'654321',username:123}],'account_shape']
 ])await assert.rejects(exchangeUnified(expects,'fixture-code',run({data:rows},original)),{step});
 assert.equal(calls,5);
});

test('callback diagnoses failure stages without exposing tokens, Meta messages or URLs',async()=>{
 const expected=[
  [{debug:{app_id:'111111'}},'token_identity'],
  [{debug:{scopes:['instagram_basic']}},'token_scope'],
  [{debug:{expires_at:0}},'token_expiry'],
  [{business:'456789'},'portfolio_policy'],
  [{accounts:{data:[]}},'account_missing'],
 ];
 for(const [fixture,step] of expected)await assert.rejects(exchangeUnified(expects,'fixture-code',fake(fixture)),error=>{
  assert.deepEqual(instagramCallbackDiagnostic(error),{step,metaCode:null});
  return true;
 });
 for(const [fragment,step] of [['/oauth/access_token','code_exchange'],['/debug_token','token_debug'],['/me','portfolio_lookup'],['/assigned_instagram_accounts','account_lookup']]){
  const run=fake();
  await assert.rejects(exchangeUnified(expects,'fixture-code',async(u,req)=>{
   if(new URL(u).pathname.endsWith(fragment))throw Object.assign(new Error('https://example.com/?token=private-value'),{code:190});
   return run(u,req);
  }),error=>{
   assert.deepEqual(instagramCallbackDiagnostic(error),{step,metaCode:190});
   assert.ok(!JSON.stringify(error).includes('private-value'));
   assert.ok(!String(error).includes('private-value'));
   return true;
  });
 }
 assert.deepEqual(instagramCallbackDiagnostic(Object.assign(new Error('private-value'),{code:190})),{step:'unexpected',metaCode:null});
});

test('owner session only, one-shot state, encrypted and read-only Unified sync',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ss-ig-unified-'));
 const store=await createStore({DATA_DIR:dir});
 const old=global.fetch;let fetches=0;
 t.after(async()=>{global.fetch=old;store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(u,o)=>{fetches++;return Response.json(await fake()(u,o));};
 await withRuntime(env,async()=>{
  assert.ok(config());
  assert.equal((await safeStatus(store)).expectedUsername,'sample_account');
  const login=new URL(await begin(store,'owner'));
  assert.equal(login.hostname,'www.facebook.com');
  assert.equal(login.searchParams.get('config_id'),'223456');
  assert.equal(login.searchParams.has('scope'),false);
  const callback=new URL('/api/instagram/callback',env.APP_ORIGIN);
  callback.searchParams.set('code','fixture-code');
  callback.searchParams.set('state',login.searchParams.get('state'));
  await assert.rejects(connect(store,'other',callback),{step:'state_session'});assert.equal(fetches,0);
  await connect(store,'owner',callback);
  await assert.rejects(connect(store,'owner',callback),/state/);
  const p=JSON.parse((await store.doc('instagram-private')).body);
  assert.equal(p.provider,'unified');assert.equal(decrypt(p.encrypted).access,'fixture-user-token');
  assert.ok(!JSON.stringify(await safeStatus(store)).includes('fixture-user-token'));
  assert.equal((await safeStatus(store)).readiness.state,'sync_unverified');
  const metrics=await sync(store);
  assert.equal(metrics.followers,123);
  assert.equal(metrics.account.reach,0);assert.equal(metrics.dm,null);
  assert.equal((await safeStatus(store)).readiness.state,'connected');
  let paths=[];
  global.fetch=async(u,o)=>{
   paths.push(new URL(u).pathname);
   return Response.json(new URL(u).pathname==='/v27.0/654321'?{id:'654321',username:'other',followers_count:456}:await fake()(u,o));
  };
  await assert.rejects(sync(store),/プロフィールが接続済みのアカウントと一致しません/);
  assert.deepEqual(paths,['/v27.0/654321']);
  const failed=await safeStatus(store);
  assert.equal(failed.cache.followers,123);assert.equal(failed.cache.syncVerified,false);
  assert.equal(failed.readiness.state,'sync_unverified');
  global.fetch=async(u,o)=>{
   const path=new URL(u).pathname;
   return Response.json(path.endsWith('/insights')?{data:[]}:await fake()(u,o));
  };
  const partial=await sync(store);
  assert.equal(partial.syncVerified,false);
  assert.ok(partial.warnings.some(w=>w.includes('数値として確認できるインサイト')));
  const {provider:_,...legacy}=p;
  await store.put('instagram-private',legacy);
  assert.equal((await safeStatus(store)).provider,'legacy');
  assert.equal((await safeStatus(store)).apiVersion,'v26.0');
  await store.put('instagram-private',p);
  assert.ok((await disconnect(store)).warning.includes('Meta Business Suite'));
 });
});
