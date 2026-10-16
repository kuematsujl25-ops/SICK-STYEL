import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac,randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {encrypt,decrypt,hash} from '../lib/security.js';
import {breakdownValues,begin,connect,metricValue,verifySignature,receiveWebhook,safeStatus,sync,disconnect} from '../integrations/instagram.js';

test('本番環境は外部DBなしで起動できない',async()=>{await assert.rejects(createStore({VERCEL:'1'}),/DATABASE_URL/);await assert.rejects(createStore({NODE_ENV:'production'}),/DATABASE_URL/);});
test('取得できない指標を0にしない・実際の0は保存する',()=>{assert.equal(metricValue({data:[]},'views'),null);assert.equal(metricValue({data:[{name:'views',values:[{value:0}]}]},'views'),0);assert.equal(metricValue({data:[{name:'reach',total_value:{value:15}}]},'reach'),15);});
test('Webhookのraw body HMAC署名を検証',()=>{const b=Buffer.from('{"entry":[]}');const signature='sha256='+createHmac('sha256','secret').update(b).digest('hex');assert.equal(verifySignature(b,signature,'secret'),true);assert.equal(verifySignature(Buffer.from('{}'),signature,'secret'),false);assert.equal(verifySignature(b,signature,'wrong'),false);assert.equal(verifySignature(b,'','secret'),false);});
test('認可stateのセッション固定・暗号化・同期・DMの重複/順序・解除',async t=>{
 const env={...process.env};process.env.INSTAGRAM_APP_ID='123';process.env.INSTAGRAM_APP_SECRET='test-app-secret';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.INSTAGRAM_ENABLE_MESSAGING='true';
 const dir=await mkdtemp(path.join(tmpdir(),'ss-ig-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;let refreshes=0;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);let data;
  if(u.hostname==='api.instagram.com')data={data:[{access_token:'short-secret',user_id:'12345',permissions:'instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_messages'}]};
  else if(u.pathname==='/access_token')data={access_token:'long-secret',expires_in:5184000};
  else if(u.pathname==='/refresh_access_token'){refreshes++;data={access_token:'refreshed-secret',expires_in:5184000};}
  else if(u.pathname.endsWith('/me'))data={user_id:'12345',username:'sickstyle'};
  else if(u.pathname.endsWith('/subscribed_apps'))data={success:true};
  else if(u.pathname.endsWith('/permissions'))data={success:true};
  else if(u.pathname.endsWith('/media')){assert.equal(options.headers.Authorization.startsWith('Bearer '),true);data={data:[{id:'999',media_product_type:'REELS',caption:'New reel',timestamp:'2026-10-16T00:00:00Z',permalink:'https://www.instagram.com/reel/example/'}]};}
  else if(u.pathname.endsWith('/insights'))data={data:[{name:'views',values:[{value:0}]},{name:'reach',values:[{value:32}]}]};
  else data={user_id:'12345',username:'sickstyle',followers_count:100};
  return Response.json(data);
 };
 const url=new URL(await begin(store,'session-a'));assert.equal(url.hostname,'www.instagram.com');assert.equal(url.searchParams.get('scope').includes('instagram_business_manage_insights'),true);const state=url.searchParams.get('state');
 const cb=new URL('http://localhost/api/instagram/callback?code=code&state='+state);
 await assert.rejects(connect(store,'session-b',cb),/state/);await connect(store,'session-a',cb);await assert.rejects(connect(store,'session-a',cb),/state/);
 let privateRecord=JSON.parse((await store.doc('instagram-private')).body);assert.equal(privateRecord.encrypted.includes('long-secret'),false);assert.equal(decrypt(privateRecord.encrypted).access,'long-secret');
 const status=await safeStatus(store);assert.equal(status.connected,true);assert.equal(JSON.stringify(status).includes('long-secret'),false);assert.equal(status.dmPending,0);
 const now=Date.now()+10;const event=(mid,ts,incoming=true)=>({object:'instagram',entry:[{id:'12345',messaging:[{sender:{id:incoming?'6789':'12345'},recipient:{id:incoming?'12345':'6789'},timestamp:ts,message:{mid,...(!incoming?{is_echo:true}:{})}}]}]});
 await receiveWebhook(store,event('in',now));await receiveWebhook(store,event('in',now));assert.equal((await store.query('SELECT * FROM ss_events')).length,1);assert.equal((await safeStatus(store)).dmPending,1);
 await receiveWebhook(store,event('out',now+10,false));await receiveWebhook(store,event('old',now-100));assert.equal((await safeStatus(store)).dmPending,0);await receiveWebhook(store,event('new',now+20));assert.equal((await safeStatus(store)).dmPending,1);
 const cache=await sync(store);assert.equal(cache.followers,100);assert.equal(cache.reels[0].values.views,0);assert.equal(cache.reels[0].values.total_interactions,null);assert.equal(cache.delta,null);assert.equal(JSON.stringify(cache).includes('long-secret'),false);
 await store.query('INSERT INTO ss_attempts(key,n,expires) VALUES ($1,1,$2)',['instagram-sync',Date.now()+180000]);await assert.rejects(disconnect(store),/処理中/);assert.equal((await safeStatus(store)).connected,true);await assert.rejects(sync(store),/処理中/);await store.query('DELETE FROM ss_attempts WHERE key=$1',['instagram-sync']);
 privateRecord.expiresAt=Date.now()+2*86400000;privateRecord.issuedAt=Date.now()-2*86400000;await store.put('instagram-private',privateRecord);await sync(store);assert.equal(refreshes,1);
 const before=(await safeStatus(store)).cache;global.fetch=async()=>{throw Error('secret must not leak');};await assert.rejects(sync(store));const after=(await safeStatus(store)).cache;assert.equal(after.syncedAt,before.syncedAt);assert.ok(after.error);assert.equal(after.error.includes('secret'),false);
 assert.ok((await disconnect(store)).warning);assert.equal((await safeStatus(store)).connected,false);assert.equal((await safeStatus(store)).cache,null);assert.equal((await store.query('SELECT * FROM ss_events')).length,0);
 const value=encrypt({access:'test'});assert.throws(()=>decrypt(value.slice(0,-5)+'aaaaa'));
});

test('フォロー/フォロー解除の内訳を解析',()=>{assert.deepEqual(breakdownValues({data:[{name:'follows_and_unfollows',total_value:{breakdowns:[{dimension_keys:['follow_type'],results:[{dimension_values:['FOLLOWER'],value:12},{dimension_values:['NON_FOLLOWER'],value:3}]}]}}]},'follows_and_unfollows'),{FOLLOWER:12,NON_FOLLOWER:3});assert.equal(breakdownValues({data:[]},'follows_and_unfollows'),null);});
