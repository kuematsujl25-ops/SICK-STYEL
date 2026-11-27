import test from 'node:test';
import assert from 'node:assert/strict';
import {productSnapshot,analyzeAmazon,renderAmazonAnalysis} from '../public/amazon-analysis.js';
const now='2026-10-31T01:00:00Z';
const order=(id,date,quantity=2,status='SHIPPED')=>({orderId:id,createdTime:date+'T10:00:00+09:00',fulfillment:{fulfillmentStatus:status},buyer:{name:'PRIVATE'},orderItems:[{orderItemId:'i',quantityOrdered:quantity,product:{asin:'B000EXAMPLE',sellerSku:'TEST-SKU',title:'合成商品',customization:{private:'SECRET'}},proceeds:{breakdowns:[{type:'ITEM',subtotal:{amount:String(quantity*1000),currencyCode:'JPY'}}]}}]});
const cache=()=>({salesSyncedAt:now,ordersSyncedAt:now,ordersPeriod:{start:'2026-10-01',end:'2026-10-31'},ordersTruncated:false,daily:Array.from({length:14},(_,i)=>({date:`2026-10-${17+i}`,sales:i<7?2000:1000,units:i<7?2:1,orders:1})),products:productSnapshot([order('a','2026-10-18',3),order('b','2026-10-25'),order('c','2026-10-26',1,'CANCELLED'),order('d','2026-10-27',1,'PENDING')])});
test('equal complete JST periods separate units/orders and cancellations; evidence-backed decline',()=>{
 const a=analyzeAmazon(cache(),now);assert.deepEqual(a.metrics.sales,{current:7000,previous:14000,delta:-7000});assert.equal(a.products[0].current.units,2);assert.equal(a.products[0].current.orders,1);assert.equal(a.products[0].current.sales,2000);assert.equal(a.products[0].current.cancelled,1);assert.equal(a.products[0].current.pending,1);assert.equal(a.products[0].delta,-1);assert.equal(a.findings.length,2);
 assert.ok(!JSON.stringify(cache().products).includes('PRIVATE'));assert.ok(!JSON.stringify(cache().products).includes('SECRET'));
});
test('missing, duplicate, truncated, stale and failed responses never imply complete zero or causal findings',()=>{
 for(const change of [c=>c.products=null,c=>c.products.invalid++,c=>c.products.duplicates++,c=>c.ordersTruncated=true,c=>c.ordersPeriod.start='2026-10-20']){const c=cache();change(c);const a=analyzeAmazon(c,now);assert.equal(a.productComplete,false);assert.ok(a.products.every(p=>p.current.units===null));assert.ok(a.findings.some(f=>f.key==='product-data'));}
 for(const change of [c=>c.salesSyncedAt='2026-10-01',c=>c.salesError='failed',c=>c.daily.pop(),c=>c.daily.push(c.daily[0])]){const c=cache();change(c);const a=analyzeAmazon(c,now);assert.ok(a.findings.some(f=>f.key==='sales-data'));assert.ok(!a.findings.some(f=>f.key==='sales-decline'));}
 const c=cache();c.products.rows[1].amount=null;assert.equal(analyzeAmazon(c,now).products[0].current.sales,null);
 const empty=analyzeAmazon(null,now);assert.equal(empty.metrics.units.current,null);
});
test('duplicates are removed and disqualify completeness, unknown quantities and absent item arrays are missing',()=>{
 const o=order('a','2026-10-25');assert.equal(productSnapshot([o,o]).rows.length,1);assert.equal(productSnapshot([o,o]).duplicates,1);
 o.orderItems.push(o.orderItems[0]);assert.equal(productSnapshot([o]).duplicates,1);
 assert.equal(productSnapshot([{...o,orderItems:undefined}]).invalid,1);
 o.orderItems=[{...o.orderItems[0],quantityOrdered:null}];assert.equal(productSnapshot([o]).rows[0].quantity,null);
});
test('JST boundary excludes current day, zero is measured only for complete periods; HTML escapes products',()=>{
 const c=cache();c.products.rows.push(...productSnapshot([order('new','2026-10-31',50)]).rows);c.products.rows[0].title='<script>bad</script>';
 const a=analyzeAmazon(c,now);assert.equal(a.products[0].current.units,2);assert.equal(a.period.end,'2026-10-30');
 const html=renderAmazonAnalysis(a,s=>String(s).replaceAll('<','&lt;'));assert.ok(!html.includes('<script>'));assert.match(html,/未取得/);
 c.products=productSnapshot([]);assert.equal(analyzeAmazon(c,now).productComplete,true);
});
