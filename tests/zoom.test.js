import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {decrypt} from '../lib/security.js';
import {begin,connect,createMeeting,updateMeeting,deleteMeeting,safeStatus,storageDiagnostics,disconnect,ZoomError} from '../integrations/zoom.js';

test('Zoom OAuth: state固定・トークン暗号化・会議作成はjoin_urlのみ返す（start_urlを渡さない）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='client-1';process.env.ZOOM_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 let refreshCount=0;
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.hostname==='zoom.us'&&u.pathname==='/oauth/token'){
   const body=new URLSearchParams(options.body);
   if(body.get('grant_type')==='refresh_token')refreshCount++;
   return Response.json({access_token:'access-secret',refresh_token:'refresh-secret-'+refreshCount,scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'});
  }
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  if(u.pathname==='/v2/users/me/meetings')return Response.json({id:987654321,join_url:'https://zoom.us/j/987654321',start_url:'https://zoom.us/s/987654321?zak=SECRET'});
  if(u.pathname==='/v2/meetings/987654321'&&options.method==='PATCH')return new Response(null,{status:204});
  if(u.pathname==='/v2/meetings/987654321'&&options.method==='DELETE')return new Response(null,{status:204});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'session-a'));assert.equal(url.hostname,'zoom.us');const state=url.searchParams.get('state');
 const cb=new URL('http://localhost/api/zoom/callback?code=code&state='+state);
 await assert.rejects(connect(store,'session-b',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'state_mismatch');assert.equal(e.stage,'state_validation');assert.match(e.message,/state/);return true;});
 await connect(store,'session-a',cb);
 await assert.rejects(connect(store,'session-a',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'state_mismatch');assert.equal(e.stage,'state_validation');return true;});
 const priv=JSON.parse((await store.doc('zoom-private')).body);
 assert.equal(JSON.stringify(priv).includes('refresh-secret'),false);
 assert.equal(decrypt(priv.encrypted).refresh,'refresh-secret-0');
 const status=await safeStatus(store);assert.equal(status.connected,true);assert.equal(status.email,'owner@example.com');
 assert.deepEqual(status.scopes,['meeting:write:meeting','meeting:update:meeting','meeting:delete:meeting','user:read:user']);
 const meeting=await createMeeting(store,{topic:'SICKSTYLE｜初回ZOOM｜FC Example',startIso:'2026-10-28T05:00:00.000Z',durationMin:45});
 assert.equal(meeting.meetingId,'987654321');
 assert.equal(meeting.joinUrl,'https://zoom.us/j/987654321');
 assert.equal(JSON.stringify(meeting).includes('zak'),false);
 assert.equal(refreshCount,1);
 await updateMeeting(store,'987654321',{topic:'変更後',startIso:'2026-10-29T05:00:00.000Z',durationMin:45});
 await deleteMeeting(store,'987654321');
 const d=await disconnect(store);assert.equal(d.ok,true);assert.equal((await safeStatus(store)).connected,false);
});

test('Zoomの認可コールバックは失敗段階ごとに区別できる安全なcode/stageを返す（原因不明のauthorization_failedにならない）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='client-1';process.env.ZOOM_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-stages-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 let tokenResponse=null;
 global.fetch=async(url)=>{const u=new URL(url);
  if(u.pathname==='/oauth/token')return Response.json(tokenResponse);
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  return new Response(null,{status:404});
 };
 const begun=async()=>new URL(await begin(store,'s'));

 // Zoom側でユーザーが拒否した場合（?error=access_denied&state=...）。stateの消費はされるが、
 // codeは発行されないため「認可コードがありません」より先にerrorパラメータで検出する。
 {const u=await begun();const cb=new URL('http://localhost/api/zoom/callback?error=access_denied&state='+u.searchParams.get('state'));
  await assert.rejects(connect(store,'s',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'user_denied');assert.equal(e.stage,'callback_params');return true;});}

 // codeパラメータが欠落（Zoom側の異常なリダイレクト、または手動でURLを組み立てた場合）。
 {const u=await begun();const cb=new URL('http://localhost/api/zoom/callback?state='+u.searchParams.get('state'));
  await assert.rejects(connect(store,'s',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'missing_code');assert.equal(e.stage,'callback_params');return true;});}

 // トークン交換は200で成功するが、応答にaccess_token/refresh_tokenが含まれない異常系。
 {tokenResponse={scope:'user:read:user'};const u=await begun();const cb=new URL('http://localhost/api/zoom/callback?code=c&state='+u.searchParams.get('state'));
  await assert.rejects(connect(store,'s',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'token_response_incomplete');assert.equal(e.stage,'token_exchange');return true;});}

 // トークン交換・スコープ照合は通るが、/users/meの応答が不完全（id/emailがない）。
 {tokenResponse={access_token:'a',refresh_token:'r',scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'};
  const brokenFetch=global.fetch;global.fetch=async(url)=>{const u=new URL(url);if(u.pathname==='/v2/users/me')return Response.json({});return brokenFetch(url);};
  const u=await begun();const cb=new URL('http://localhost/api/zoom/callback?code=c&state='+u.searchParams.get('state'));
  await assert.rejects(connect(store,'s',cb),e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'profile_incomplete');assert.equal(e.stage,'profile');return true;});
  global.fetch=brokenFetch;}

 // 登録済みスコープがコード側の必須スコープ（user:read:user等）を満たさない場合
 // （例: Zoom Marketplaceで旧来の「user:read」のみを選択し、必要な granular scope を選び忘れた場合）。
 // トークン交換自体は成功するため、ここで明確に止めて不足スコープ名を示す。
 {tokenResponse={access_token:'a',refresh_token:'r',scope:'user:read meeting:write'};
  const u=await begun();const cb=new URL('http://localhost/api/zoom/callback?code=c&state='+u.searchParams.get('state'));
  await assert.rejects(connect(store,'s',cb),e=>{
   assert.ok(e instanceof ZoomError);assert.equal(e.code,'scope_missing');assert.equal(e.stage,'scope_check');
   assert.match(e.message,/user:read:user/);assert.match(e.message,/meeting:write:meeting/);
   return true;
  });
  assert.equal(await store.doc('zoom-private'),undefined,'スコープ不足のまま接続情報を保存してはいけない');}
});

test('ローテーション後の新しいrefresh_tokenの保存自体が失敗したら、黙って成功扱いにせず明示的に失敗させる（Codex独立レビュー指摘の回帰：P1）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='client-1';process.env.ZOOM_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-persist-fail-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.hostname==='zoom.us'&&u.pathname==='/oauth/token')return Response.json({access_token:'access-x',refresh_token:'refresh-x',scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'});
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));await connect(store,'s',new URL('http://localhost/api/zoom/callback?code=c&state='+url.searchParams.get('state')));
 const before=JSON.parse((await store.doc('zoom-private')).body);
 // zoom-private documentへのUPDATEのうち、1回目（＝リース取得）は通すが、それ以降（ローテーション後の
 // 新トークンを書き込む本保存。1回だけの再試行を含む）はすべてD1障害として失敗させる。
 const realQuery=store.query.bind(store);let zoomPrivateUpdateCount=0;
 store.query=(text,values)=>{
  if(text.includes('UPDATE ss_documents')&&String(values?.[1])==='zoom-private'){
   zoomPrivateUpdateCount++;
   if(zoomPrivateUpdateCount>=2)throw Error('simulated D1 write failure');
  }
  return realQuery(text,values);
 };
 await assert.rejects(createMeeting(store,{topic:'t',startIso:'2026-10-28T05:00:00.000Z',durationMin:45}),
  e=>{assert.ok(e instanceof ZoomError);assert.equal(e.code,'token_persist_failed');assert.equal(e.stage,'token_refresh');return true;},
  '新しいrefresh_tokenを保存できない場合、access_tokenだけ返して成功したふりをしてはいけない');
 store.query=realQuery;
 const after=JSON.parse((await store.doc('zoom-private')).body);
 assert.deepEqual(decrypt(after.encrypted),decrypt(before.encrypted),'保存に失敗した以上、DB上のrefresh_tokenは古いまま（Zoom側では既に無効）であることが分かる');
});

test('同時に2件の会議を作成しても、refresh_tokenのローテーションで接続が壊れない（Codex独立レビュー指摘の回帰）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='client-1';process.env.ZOOM_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-token-race-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 let refreshCount=0,meetingSeq=0;
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.hostname==='zoom.us'&&u.pathname==='/oauth/token'){
   const body=new URLSearchParams(options.body);
   if(body.get('grant_type')==='refresh_token'){refreshCount++;return Response.json({access_token:'access-'+refreshCount,refresh_token:'refresh-'+refreshCount,scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'});}
   return Response.json({access_token:'access-initial',refresh_token:'refresh-initial',scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'});
  }
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  if(u.pathname==='/v2/users/me/meetings'&&options.method==='POST'){meetingSeq++;return Response.json({id:9000+meetingSeq,join_url:'https://zoom.us/j/'+(9000+meetingSeq)});}
  if(/^\/v2\/meetings\/\d+$/.test(u.pathname)&&options.method==='PATCH')return new Response(null,{status:204});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));await connect(store,'s',new URL('http://localhost/api/zoom/callback?code=c&state='+url.searchParams.get('state')));
 // 2つの異なる会議の作成を同時に走らせる：どちらもaccessToken()内で同じ出発点のrefresh_tokenを
 // 読んでトークン交換を行いうる。
 const [a,b]=await Promise.all([
  createMeeting(store,{topic:'会議A',startIso:'2026-10-28T05:00:00.000Z',durationMin:45}),
  createMeeting(store,{topic:'会議B',startIso:'2026-10-28T06:00:00.000Z',durationMin:45}),
 ]);
 assert.notEqual(a.meetingId,b.meetingId,'両方とも実際に会議が作成されている（片方が失敗で握りつぶされていない）');
 // 保存は壊れていない（JSONとして読める・空になっていない）こと、またこの後の呼び出しが
 // （保存されたどちらかのrefresh_tokenで）正常に継続できることを確認する。
 const priv=JSON.parse((await store.doc('zoom-private')).body);
 assert.ok(priv.encrypted);
 await assert.doesNotReject(updateMeeting(store,String(a.meetingId),{topic:'更新後',startIso:'2026-10-29T05:00:00.000Z',durationMin:45}),'競合後も接続が壊れておらず、次の操作が引き続き成功する');
});

test('Zoomのエラー応答を403/429のヒント付きで分類する',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-err-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.pathname==='/oauth/token')return Response.json({access_token:'a',refresh_token:'r',scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'});
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  if(u.pathname==='/v2/users/me/meetings')return Response.json({code:429,message:'Too many requests'},{status:429});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));const cb=new URL('http://localhost/api/zoom/callback?code=c&state='+url.searchParams.get('state'));
 await connect(store,'s',cb);
 await assert.rejects(createMeeting(store,{topic:'t',startIso:'2026-10-28T05:00:00.000Z',durationMin:45}),e=>{assert.ok(e instanceof ZoomError);assert.match(e.message,/呼び出し上限/);return true;});
});

test('Zoomがエラー応答に任意の文字列を返してもOAuthログの例外に転記しない',async t=>{
 const original={...process.env},originalFetch=global.fetch;
 process.env.ZOOM_CLIENT_ID='client-test';process.env.ZOOM_CLIENT_SECRET='secret-test';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-safe-error-'));
 const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async()=>Response.json({code:'invalid_grant',message:'SENSITIVE_TOKEN_MUST_NOT_BE_LOGGED'},{status:400});
 const authorization=new URL(await begin(store,'s'));
 const cb=new URL('http://localhost/api/zoom/callback?code=dummy&state='+authorization.searchParams.get('state'));
 await assert.rejects(connect(store,'s',cb),e=>{
  assert.ok(e instanceof ZoomError);
  assert.equal(e.stage,'token_exchange');
  assert.equal(e.code,'invalid_grant');
  assert.equal(e.message.includes('SENSITIVE_TOKEN_MUST_NOT_BE_LOGGED'),false);
  return true;
 });
});

test('Zoom保存前診断: 暗号化→D1書き込み/削除を検証し既存業務文書を変更しない',async t=>{
 const env={...process.env};process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-diagnostic-'));const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 await store.put('workspace',{goals:[],tasks:[],brand:{Mission:'重要な既存情報'}});
 const before=(await store.doc('workspace')).body;
 const ok=await storageDiagnostics(store);
 assert.deepEqual(ok,{ok:true,stage:'ready',code:'ready'});
 const after=(await store.doc('workspace')).body;
 assert.equal(before,after);
 assert.equal((await store.query('SELECT name FROM ss_documents WHERE name LIKE $1',['zoom-storage-check:%'])).length,0);
 process.env.TOKEN_ENCRYPTION_KEY='not-base64-32-byte-key';
 const bad=await storageDiagnostics(store);
 assert.deepEqual(bad,{ok:false,stage:'encryption',code:'encryption_failed'});
 const failingStore={transaction:async()=>{throw new Error('PRIVATE DATABASE MESSAGE');}};
 process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const fail=await storageDiagnostics(failingStore);
 assert.deepEqual(fail,{ok:false,stage:'database_write',code:'database_write_failed'});
 assert.equal(JSON.stringify(fail).includes('PRIVATE DATABASE MESSAGE'),false);
});

test('Zoom OAuth認証後の暗号化失敗とDB保存失敗を安全に区別する',async t=>{
 const env={...process.env},oldFetch=global.fetch;
 process.env.ZOOM_CLIENT_ID='client-test';process.env.ZOOM_CLIENT_SECRET='secret-test';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-failures-'));const store=await createStore({DATA_DIR:dir});
 t.after(async()=>{global.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async url=>new URL(url).pathname==='/oauth/token'?
   Response.json({access_token:'do-not-log',refresh_token:'do-not-log',scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user'}):
   Response.json({id:'u-1',email:'owner@example.com'});
 const callback=async()=>{const u=new URL(await begin(store,'s'));return new URL('http://localhost/api/zoom/callback?code=c&state='+u.searchParams.get('state'));};
 process.env.TOKEN_ENCRYPTION_KEY='wrong';
 await assert.rejects(connect(store,'s',await callback()),e=>{assert.equal(e.code,'encryption_failed');assert.equal(e.stage,'encryption');assert.equal(e.message.includes('do-not-log'),false);return true;});
 process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const put=store.put;store.put=async()=>{throw new Error('DATABASE_SECRET_SHOULD_NOT_LOG');};
 await assert.rejects(connect(store,'s',await callback()),e=>{assert.equal(e.code,'database_write_failed');assert.equal(e.stage,'database_write');assert.equal(e.message.includes('DATABASE_SECRET_SHOULD_NOT_LOG'),false);return true;});
 store.put=put;
 assert.equal(await store.doc('zoom-private'),undefined);
});
