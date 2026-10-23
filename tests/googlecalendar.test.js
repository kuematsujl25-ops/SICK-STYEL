import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {decrypt} from '../lib/security.js';
import {begin,connect,createEvent,updateEvent,deleteEvent,safeStatus,disconnect,GoogleCalendarError} from '../integrations/googlecalendar.js';

test('Google Calendar OAuth: オフラインアクセス必須・state固定・トークン暗号化・予定作成',async t=>{
 const env={...process.env};process.env.GOOGLE_CLIENT_ID='client-1';process.env.GOOGLE_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-gcal-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com'&&u.pathname==='/token'){
   const body=new URLSearchParams(options.body);
   if(body.get('grant_type')==='authorization_code'&&!body.get('refresh_token')&&body.get('code')==='code')return Response.json({access_token:'access-secret',refresh_token:'refresh-secret',scope:'https://www.googleapis.com/auth/calendar.events'});
   if(body.get('grant_type')==='refresh_token')return Response.json({access_token:'fresh-access-secret'});
   return Response.json({error:'invalid_grant'},{status:400});
  }
  if(u.hostname==='www.googleapis.com'&&u.pathname==='/oauth2/v3/userinfo')return Response.json({error:{code:403,message:'insufficient authentication scopes'}},{status:403});
  if(u.pathname==='/calendar/v3/calendars/primary/events'&&options.method==='POST')return Response.json({id:'evt123',htmlLink:'https://calendar.google.com/event?eid=evt123'});
  if(u.pathname==='/calendar/v3/calendars/primary/events/evt123'&&options.method==='PATCH')return new Response(null,{status:204});
  if(u.pathname==='/calendar/v3/calendars/primary/events/evt123'&&options.method==='DELETE')return new Response(null,{status:204});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'session-a'));
 assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('prompt'),'consent');
 assert.deepEqual(url.searchParams.get('scope').split(' '),['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendars.readonly']);
 const state=url.searchParams.get('state');
 const cb=new URL('http://localhost/api/googlecalendar/callback?code=code&state='+state);
 await assert.rejects(connect(store,'session-b',cb),/state/);
 await connect(store,'session-a',cb);
 const priv=JSON.parse((await store.doc('googlecalendar-private')).body);
 assert.equal(JSON.stringify(priv).includes('refresh-secret'),false);
 assert.equal(decrypt(priv.encrypted).refresh,'refresh-secret');
 const status=await safeStatus(store);assert.equal(status.connected,true);assert.equal(status.email,null,'カレンダー予定権限のみでプロフィール情報は取得しない');
 const event=await createEvent(store,{summary:'SICKSTYLE｜初回ZOOM｜FC Example',description:'desc',location:'https://zoom.us/j/1',startIso:'2026-10-28T05:00:00.000Z',endIso:'2026-10-28T05:45:00.000Z',attendees:[]});
 assert.equal(event.eventId,'evt123');
 await updateEvent(store,'evt123',{summary:'変更後',description:'d',location:'',startIso:'2026-10-29T05:00:00.000Z',endIso:'2026-10-29T05:45:00.000Z'});
 await deleteEvent(store,'evt123');
 const d=await disconnect(store);assert.equal(d.ok,true);assert.equal((await safeStatus(store)).connected,false);
});

test('認可応答にrefresh_tokenがなければ明確なエラーにする（再認可を促す）',async t=>{
 const env={...process.env};process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-gcal-norefresh-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async url=>{const u=new URL(url);if(u.pathname==='/token')return Response.json({access_token:'a'});return new Response(null,{status:404});};
 const url=new URL(await begin(store,'s'));const cb=new URL('http://localhost/api/googlecalendar/callback?code=c&state='+url.searchParams.get('state'));
 await assert.rejects(connect(store,'s',cb),/オフラインアクセス/);
});

test('Googleのエラー応答を401/403/429のヒント付きで分類する',async t=>{
 const env={...process.env};process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-gcal-err-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.pathname==='/token')return Response.json({access_token:'a',refresh_token:'r'});
  if(u.pathname==='/oauth2/v3/userinfo')return Response.json({error:{code:403,message:'insufficient authentication scopes'}},{status:403});
  if(u.pathname==='/calendar/v3/calendars/primary/events'&&options.method==='POST')return Response.json({error:{code:403,message:'Forbidden'}},{status:403});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));const cb=new URL('http://localhost/api/googlecalendar/callback?code=c&state='+url.searchParams.get('state'));
 await connect(store,'s',cb);
 await assert.rejects(createEvent(store,{summary:'t',description:'',location:'',startIso:'2026-10-28T05:00:00.000Z',endIso:'2026-10-28T05:45:00.000Z'}),e=>{assert.ok(e instanceof GoogleCalendarError);assert.match(e.message,/権限不足/);return true;});
});

test('予定作成がHTTP成功応答を返したのに本文を読み取れない場合、確定失敗ではなく専用のresponse_body_unreadableとして区別する（Codex独立レビュー指摘の回帰：区別しないと、実際には作成済みの予定が再試行で重複作成される）',async t=>{
 const env={...process.env};process.env.GOOGLE_CLIENT_ID='c';process.env.GOOGLE_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-gcal-body-unreadable-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.pathname==='/token')return Response.json({access_token:'a',refresh_token:'r'});
  // HTTPとしては成功（2xx）だが、本文が壊れていてresponse.json()が失敗する状況を再現する
  // （Googleは予定を作成済みの可能性が高い）。
  if(u.pathname==='/calendar/v3/calendars/primary/events'&&options.method==='POST')return new Response('{not valid json',{status:200,headers:{'Content-Type':'application/json'}});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));const cb=new URL('http://localhost/api/googlecalendar/callback?code=c&state='+url.searchParams.get('state'));
 await connect(store,'s',cb);
 await assert.rejects(createEvent(store,{summary:'t',description:'',location:'',startIso:'2026-10-28T05:00:00.000Z',endIso:'2026-10-28T05:45:00.000Z'}),e=>{
  assert.ok(e instanceof GoogleCalendarError);assert.equal(e.code,'response_body_unreadable');assert.match(e.message,/作成されている可能性があります/);return true;
 });
});

test('朝の予定は全ページを取得し、途中失敗・循環トークンでは部分件数を返さない',async t=>{
 const {encrypt}=await import('../lib/security.js');const {listToday}=await import('../integrations/googlecalendar.js');
 const {withRuntime}=await import('../lib/runtime.js');const original=global.fetch;t.after(()=>global.fetch=original);
 await withRuntime({TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')},async()=>{
  const store={doc:async()=>({body:JSON.stringify({encrypted:encrypt({refresh:'dummy'})})})};let mode='ok',calls=[];
  global.fetch=async url=>{const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'dummy'});calls.push(u);
   if(!u.searchParams.has('pageToken'))return Response.json({items:Array.from({length:50},(_,i)=>({id:String(i)})),nextPageToken:'next'});
   if(mode==='fail')return Response.json({error:{code:403}},{status:403});
   return Response.json({items:[{id:'last'}],...(mode==='loop'?{nextPageToken:'next'}:{})});};
  const r=await listToday(store,'2026-10-23');assert.equal(r.events.length,51);assert.equal(calls[1].searchParams.get('pageToken'),'next');assert.equal(calls[0].searchParams.get('timeMin'),calls[1].searchParams.get('timeMin'));
  mode='fail';await assert.rejects(listToday(store,'2026-10-23'));
  mode='loop';await assert.rejects(listToday(store,'2026-10-23'),/全件取得/);
 });
});
