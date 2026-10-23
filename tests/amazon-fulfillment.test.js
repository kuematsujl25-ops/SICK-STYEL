import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStore} from '../lib/store.js';
import {withRuntime} from '../lib/runtime.js';
import {sync,safeStatus} from '../integrations/amazon.js';
import {amazonOpenOrders} from '../public/integration-status.js';

test('Amazon fulfillment is requested on every page, persisted, reloaded and retained on missing data or failure',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ss-fulfillment-'));let store=await createStore({DATA_DIR:dir});
 const original=global.fetch;let mode='success',pages=0;
 t.after(async()=>{global.fetch=original;store.close();await rm(dir,{recursive:true,force:true});});
 global.fetch=async(url)=>{
  const u=new URL(url);
  if(u.hostname==='api.amazon.com')return Response.json({access_token:'test-access'});
  if(u.pathname==='/sales/v1/orderMetrics')return Response.json({payload:[{interval:'2026-10-16T00:00:00+09:00--2026-10-17T00:00:00+09:00',totalSales:{amount:500,currencyCode:'JPY'},orderCount:2,unitCount:2}]});
  assert.equal(u.pathname,'/orders/2026-01-01/orders');
  assert.equal(u.searchParams.get('includedData'),'FULFILLMENT');
  assert.equal(u.searchParams.get('maxResultsPerPage'),'100');pages++;
  if(mode==='failure')return Response.json({errors:[{code:'Unauthorized'}]},{status:403});
  if(mode==='missing')return Response.json({orders:[{orderId:'example-order'}]});
  const second=u.searchParams.has('paginationToken');
  return Response.json({orders:[{orderId:second?'example-2':'example-1',fulfillment:{fulfillmentStatus:second?'SHIPPED':'UNSHIPPED'},orderItems:[{quantityOrdered:1}]}],pagination:second?{}:{nextToken:'test-page-2'}});
 };
 await withRuntime({AMAZON_LWA_CLIENT_ID:'test-client',AMAZON_LWA_CLIENT_SECRET:'test-secret',AMAZON_REFRESH_TOKEN:'test-refresh',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString('base64')},async()=>{
  await store.put('amazon-cache',{dailyHistory:[{date:'2026-08-01',sales:100,currency:'JPY',orders:1,units:1}]});
  await sync(store,new Date('2026-10-16T05:00:00Z'));
  assert.equal(pages,2);
  store.close();store=await createStore({DATA_DIR:dir});
  let st=await safeStatus(store);const successful=st.cache;
  assert.equal(amazonOpenOrders(st),1);assert.equal(st.cache.syncVerified,true);
  assert.ok(st.cache.dailyHistory.some(d=>d.date==='2026-08-01'));
  for(mode of ['missing','failure']){
   await sync(store,new Date('2026-10-16T05:00:00Z'));
   st=await safeStatus(store);
   assert.deepEqual(st.cache.orders,successful.orders);
   assert.equal(st.cache.ordersSyncedAt,successful.ordersSyncedAt);
   assert.equal(st.cache.monthSales,500);
   assert.equal(st.cache.syncVerified,false);
   assert.ok(st.cache.ordersError);
   assert.equal(amazonOpenOrders(st),null);
   assert.equal(st.connected,true);
  }
 });
});

test('unknown, partial, missing and failed order counts never mean zero unshipped orders',()=>{
 const status={connected:true,cache:{ordersSyncedAt:'2026-10-16T05:00:00Z',orders:{counts:{SHIPPED:2},total:2}}};
 assert.equal(amazonOpenOrders(status),0);
 for(const patch of [
  {orders:{counts:{UNKNOWN:2},total:2}},
  {orders:{counts:{SHIPPED:1},total:2}},
  {orders:{counts:{UNSHIPPED:-1},total:-1}},
  {ordersTruncated:true},{ordersError:'failed'},{error:'failed'},{ordersSyncedAt:null},
 ])assert.equal(amazonOpenOrders({...status,cache:{...status.cache,...patch}}),null);
 assert.equal(amazonOpenOrders({connected:false,cache:status.cache}),null);
 assert.equal(amazonOpenOrders({...status,cache:{...status.cache,orders:{counts:{},total:0}}}),0);
});
