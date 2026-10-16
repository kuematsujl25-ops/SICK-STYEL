import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createStore} from '../lib/store.js';
import * as amazon from '../integrations/amazon.js';
test('売上の集計期間は日本時間・注文状況はキャンセルを別計上',()=>{
 const r=amazon.salesInterval(new Date('2026-10-16T15:30:00Z'));assert.equal(r.start,'2026-09-17');assert.match(r.interval,/^2026-09-17T00:00:00\+09:00--2026-10-17T00:25:00\+09:00$/);
 const m=amazon.parseMetrics([{interval:'2026-10-16T00:00:00+09:00--2026-10-17T00:00:00+09:00',totalSales:{amount:'12345.00',currencyCode:'JPY'},orderCount:3,unitCount:4},{interval:'2026-10-15T00:00+09:00--x',totalSales:{},orderCount:0,unitCount:0}]);
 assert.deepEqual(m[0],{date:'2026-10-16',sales:12345,currency:'JPY',orders:3,units:4});assert.equal(m[1].sales,null);assert.equal(m[1].orders,0);
 const s=amazon.summarizeOrders([{orderId:'A',fulfillment:{fulfillmentStatus:'UNSHIPPED',fulfilledBy:'MERCHANT'},orderItems:[{quantityOrdered:2}],createdTime:'2026-10-02'},{orderId:'B',fulfillment:{fulfillmentStatus:'CANCELLED'}},{orderId:'C',fulfillment:{fulfillmentStatus:'SHIPPED'}}]);
 assert.deepEqual(s.counts,{UNSHIPPED:1,CANCELLED:1,SHIPPED:1});assert.equal(s.open.length,1);assert.equal(s.open[0].items,2);
});
test('Amazon認可: state固定・トークン暗号化・同期・失敗時の前回値保持・解除',async t=>{
 const saved={...process.env};Object.assign(process.env,{AMAZON_LWA_CLIENT_ID:'amzn1.application-oa2-client.test',AMAZON_LWA_CLIENT_SECRET:'test-client-secret',AMAZON_APP_ID:'amzn1.sp.solution.test',APP_ORIGIN:'https://example.workers.dev',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')});delete process.env.AMAZON_REFRESH_TOKEN;
 const dir=await mkdtemp(path.join(tmpdir(),'ss-amz-'));const store=await createStore({DATA_DIR:dir});const realFetch=global.fetch;const calls=[];let fail=false;
 t.after(async()=>{global.fetch=realFetch;process.env=saved;store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url,opt={})=>{const u=new URL(url);calls.push(u.hostname+u.pathname);
  if(u.href==='https://api.amazon.com/auth/o2/token'){const b=new URLSearchParams(opt.body);if(b.get('grant_type')==='authorization_code'){assert.equal(b.get('redirect_uri'),'https://example.workers.dev/api/amazon/callback');return Response.json({refresh_token:'Atzr|refresh-secret',access_token:'x'});}assert.equal(b.get('refresh_token'),'Atzr|refresh-secret');return Response.json({access_token:'Atza|access',expires_in:3600});}
  assert.equal(u.hostname,'sellingpartnerapi-fe.amazon.com');assert.equal(opt.headers['x-amz-access-token'],'Atza|access');assert.equal(u.searchParams.get('marketplaceIds'),'A1VC38T7YXB528');
  if(fail)return Response.json({errors:[{code:'Unauthorized'}]},{status:403});
  if(u.pathname==='/sales/v1/orderMetrics'){assert.equal(u.searchParams.get('granularityTimeZone'),'Asia/Tokyo');return Response.json({payload:[{interval:'2026-10-16T00:00:00+09:00--2026-10-17T00:00:00+09:00',totalSales:{amount:'5000',currencyCode:'JPY'},orderCount:2,unitCount:2}]});}
  if(u.pathname==='/orders/2026-01-01/orders')return Response.json({orders:[{orderId:'503-1',fulfillment:{fulfillmentStatus:'UNSHIPPED'},orderItems:[{quantityOrdered:1}]}]});
  throw Error('unexpected '+u.href);};
 const consent=new URL(await amazon.begin(store,'session-a'));assert.equal(consent.origin,'https://sellercentral.amazon.co.jp');assert.equal(consent.searchParams.get('version'),'beta');const state=consent.searchParams.get('state');
 await assert.rejects(amazon.login(store,'session-a',new URL('https://x/api/amazon/login?amazon_callback_uri=https://evil.example/cb&amazon_state=s')),/戻り先/);
 const back=new URL(await amazon.login(store,'session-a',new URL('https://x/api/amazon/login?amazon_callback_uri='+encodeURIComponent('https://sellercentral.amazon.co.jp/apps/authorize/confirm/amzn1')+'&amazon_state=as1&selling_partner_id=A1')));assert.equal(back.searchParams.get('amazon_state'),'as1');const state2=back.searchParams.get('state');
 await assert.rejects(amazon.connect(store,'session-b',new URL(`https://x/cb?state=${state2}&spapi_oauth_code=c&selling_partner_id=A1`)),/state/);
 await amazon.connect(store,'session-a',new URL(`https://x/cb?state=${state2}&spapi_oauth_code=c&selling_partner_id=A1SELLER`));
 await assert.rejects(amazon.connect(store,'session-a',new URL(`https://x/cb?state=${state2}&spapi_oauth_code=c`)),/state/);
 const raw=(await store.doc('amazon-private')).body;assert.equal(raw.includes('refresh-secret'),false);
 let st=await amazon.safeStatus(store);assert.equal(st.connected,true);assert.equal(JSON.stringify(st).includes('refresh'),false);
 await amazon.sync(store,new Date('2026-10-16T05:00:00Z'));st=await amazon.safeStatus(store);assert.equal(st.cache.monthSales,5000);assert.equal(st.cache.orders.counts.UNSHIPPED,1);assert.equal(st.cache.error,null);
 fail=true;await assert.rejects(amazon.sync(store),/Amazon/);st=await amazon.safeStatus(store);assert.equal(st.cache.monthSales,5000);assert.match(st.cache.error,/403|Unauthorized|権限/);
 await amazon.disconnect(store);st=await amazon.safeStatus(store);assert.equal(st.connected,false);assert.equal(st.cache,null);
 assert.equal(calls.every(h=>h.startsWith('api.amazon.com')||h.startsWith('sellingpartnerapi-fe.amazon.com')),true);
});
