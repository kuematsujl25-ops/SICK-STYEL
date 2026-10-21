import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import {decrypt} from '../lib/security.js';
import {begin,connect,createMeeting,updateMeeting,deleteMeeting,safeStatus,disconnect,ZoomError} from '../integrations/zoom.js';

test('Zoom OAuth: state固定・トークン暗号化・会議作成はjoin_urlのみ返す（start_urlを渡さない）',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='client-1';process.env.ZOOM_CLIENT_SECRET='secret-1';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 let refreshCount=0;
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.hostname==='zoom.us'&&u.pathname==='/oauth/token'){
   const body=new URLSearchParams(options.body);
   if(body.get('grant_type')==='refresh_token')refreshCount++;
   return Response.json({access_token:'access-secret',refresh_token:'refresh-secret-'+refreshCount,scope:'meeting:write:meeting meeting:update:meeting meeting:delete:meeting user:read:user:me'});
  }
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  if(u.pathname==='/v2/users/me/meetings')return Response.json({id:987654321,join_url:'https://zoom.us/j/987654321',start_url:'https://zoom.us/s/987654321?zak=SECRET'});
  if(u.pathname==='/v2/meetings/987654321'&&options.method==='PATCH')return new Response(null,{status:204});
  if(u.pathname==='/v2/meetings/987654321'&&options.method==='DELETE')return new Response(null,{status:204});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'session-a'));assert.equal(url.hostname,'zoom.us');const state=url.searchParams.get('state');
 const cb=new URL('http://localhost/api/zoom/callback?code=code&state='+state);
 await assert.rejects(connect(store,'session-b',cb),/state/);
 await connect(store,'session-a',cb);
 await assert.rejects(connect(store,'session-a',cb),/state/);
 const priv=JSON.parse((await store.doc('zoom-private')).body);
 assert.equal(JSON.stringify(priv).includes('refresh-secret'),false);
 assert.equal(decrypt(priv.encrypted).refresh,'refresh-secret-0');
 const status=await safeStatus(store);assert.equal(status.connected,true);assert.equal(status.email,'owner@example.com');
 const meeting=await createMeeting(store,{topic:'SICKSTYLE｜初回ZOOM｜FC Example',startIso:'2026-10-28T05:00:00.000Z',durationMin:45});
 assert.equal(meeting.meetingId,'987654321');
 assert.equal(meeting.joinUrl,'https://zoom.us/j/987654321');
 assert.equal(JSON.stringify(meeting).includes('zak'),false);
 assert.equal(refreshCount,1);
 await updateMeeting(store,'987654321',{topic:'変更後',startIso:'2026-10-29T05:00:00.000Z',durationMin:45});
 await deleteMeeting(store,'987654321');
 const d=await disconnect(store);assert.equal(d.ok,true);assert.equal((await safeStatus(store)).connected,false);
});

test('Zoomのエラー応答を403/429のヒント付きで分類する',async t=>{
 const env={...process.env};process.env.ZOOM_CLIENT_ID='c';process.env.ZOOM_CLIENT_SECRET='s';process.env.APP_ORIGIN='http://127.0.0.1:3000';process.env.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const dir=await mkdtemp(path.join(tmpdir(),'ss-zoom-err-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;
 t.after(async()=>{global.fetch=realFetch;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,options)=>{const u=new URL(url);
  if(u.pathname==='/oauth/token')return Response.json({access_token:'a',refresh_token:'r'});
  if(u.pathname==='/v2/users/me')return Response.json({id:'u1',email:'owner@example.com'});
  if(u.pathname==='/v2/users/me/meetings')return Response.json({code:429,message:'Too many requests'},{status:429});
  return new Response(null,{status:404});
 };
 const url=new URL(await begin(store,'s'));const cb=new URL('http://localhost/api/zoom/callback?code=c&state='+url.searchParams.get('state'));
 await connect(store,'s',cb);
 await assert.rejects(createMeeting(store,{topic:'t',startIso:'2026-10-28T05:00:00.000Z',durationMin:45}),e=>{assert.ok(e instanceof ZoomError);assert.match(e.message,/呼び出し上限/);return true;});
});
