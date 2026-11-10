import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderInsight,adInsight,renderOrderInsights,renderAdInsights} from '../public/amazon-insights.js';
const period={start:'2026-10-01',end:'2026-10-02',windowDays:7};
const row={periodStart:period.start,periodEnd:period.end,adCost:10,attributedSales:100,clicks:2,impressions:20};
const s={configured:true,connected:true,lastSuccess:'2026-10-03T00:00:00Z',period,rows:[row,{...row,adCost:90,attributedSales:100}]};
test('Ads totals use sums, not ratio averages; missing and zero denominator stay unknown',()=>{
 assert.deepEqual(adInsight(s),{cost:100,sales:200,clicks:4,impressions:40,roas:2,acos:50,empty:false});
 assert.equal(adInsight({...s,rows:[{...row,adCost:0}]}).roas,null);
 assert.equal(adInsight({...s,rows:[{...row,attributedSales:0}]}).acos,null);
 assert.equal(adInsight({...s,rows:[row,{...row,adCost:null}]}).cost,null);
 assert.equal(adInsight({...s,rows:[]}).cost,null);
 assert.equal(adInsight({...s,connected:false}),null);
 assert.equal(adInsight({...s,period:null}),null);
 assert.equal(adInsight({...s,rows:[{...row,periodEnd:'2026-11-01'}]}).empty,true);
});
test('only allowlisted nonPII fields survive; SHIPPED never means delivered',()=>{
 const result=orderInsight({orderId:'example-1',recipient:{name:'SENSITIVE'},buyer:{email:'SENSITIVE'},fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus:'SHIPPED',shipByWindow:{latestDateTime:'2026-10-02T12:00:00Z'}},packages:[{trackingNumber:'SENSITIVE',shipFromAddress:'SENSITIVE',packageStatus:{status:'IN_TRANSIT',detailedStatus:'SENSITIVE'}}]});
 assert.equal(JSON.stringify(result).includes('SENSITIVE'),false);
 assert.equal(result.shipBy,'2026-10-02T12:00:00.000Z');
 const html=renderOrderInsights({connected:true,cache:{orders:{details:[result]}}});
 assert.match(html,/輸送中/);assert.match(html,/発送済み/);assert.doesNotMatch(html,/<td>配達完了/);
 assert.equal(orderInsight({orderId:'<script>',fulfillment:{fulfillmentStatus:'secret'}}).status,'UNKNOWN');
});
test('read UI distinguishes unavailable, failed prior data, generating, empty and truncated',()=>{
 assert.match(renderAdInsights(null),/未連携/);assert.match(renderAdInsights({...s,job:{status:'pending'}}),/前回成功分/);
 assert.match(renderAdInsights({...s,error:'failed'}),/取得失敗/);
 assert.match(renderAdInsights({...s,rows:[]}),/0件/);
 assert.match(renderOrderInsights({connected:true,cache:{}}),/詳細未取得/);
 assert.match(renderOrderInsights({connected:true,cache:{orders:{details:[]},ordersTruncated:true,ordersError:'failed'}}),/全件ではありません/);
});

test('unknown fulfillment owner cannot be reported as zero merchant orders',()=>{const html=renderOrderInsights({connected:true,cache:{orders:{details:[orderInsight({orderId:'example',fulfillment:{fulfillmentStatus:'UNSHIPPED'}})]}}});assert.match(html,/発送元不明が1件/);assert.doesNotMatch(html,/注文は0件/);});
