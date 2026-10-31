// Loopback-only UI QA with synthetic data. Never calls Amazon or the production app.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {empty} from '../lib/domain.js';
import {orderInsight} from '../public/amazon-insights.js';
const publicRoot=new URL('../public/',import.meta.url);
let expired=false;
const stamp='2026-10-27T00:00:00Z',period={start:'2026-10-01',end:'2026-10-26',windowDays:7};
const rows=['UNSHIPPED','PARTIALLY_SHIPPED','SHIPPED'].map((status,i)=>orderInsight({orderId:'SYNTHETIC-'+i,fulfillment:{fulfilledBy:'MERCHANT',fulfillmentStatus:status,shipByWindow:{latestDateTime:stamp}},packages:i?[{packageStatus:{status:i===1?'IN_TRANSIT':'DELIVERED'}}]:[]}));
const amazon={configured:true,connected:true,cache:{ordersSyncedAt:stamp,ordersPeriod:period,orders:{counts:{UNSHIPPED:1,PARTIALLY_SHIPPED:1,SHIPPED:1},total:3,open:[],details:rows},daily:[]}};
const ads={configured:true,connected:true,lastSuccess:stamp,period,rows:[{id:'synthetic',platform:'Amazon',source:'api',adProduct:'SP',currency:'JPY',periodStart:period.start,periodEnd:period.end,attributionWindowDays:7,adCost:100,attributedSales:400,clicks:10,impressions:200,campaign:'SYNTHETIC ONLY'}]};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/qa-expire'){expired=true;res.end('Synthetic session expired. Return to app and refresh.');return;}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');const path=url.pathname.slice(5);
 if(path==='session'){res.end(JSON.stringify({configured:true,authenticated:!expired,storage:'sqlite'}));return;}
 if(expired){res.statusCode=401;res.end(JSON.stringify({error:'Synthetic session expired'}));return;}
 if(path==='amazonads/sync'){await new Promise(r=>setTimeout(r,1500));res.end(JSON.stringify({...ads,job:{status:'pending'}}));return;}
 if(path==='logout'){expired=true;res.end('{}');return;}
 res.end(JSON.stringify(path==='data'?empty():path==='amazon/status'||path==='amazon/sync'?amazon:path==='amazonads/status'?ads:path==='instagram/conversations'?{data:[]}:{}));return;
 }
 const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(name)){res.statusCode=404;res.end();return;}
 try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/png');let content=readFileSync(new URL(name,publicRoot));if(name==='index.html')content=content.toString().replace('<body>','<body><p style="background:#ffe500;color:#000">合成データ専用QA — 実データではありません</p>');res.end(content);}catch{res.statusCode=404;res.end();}
}).listen(4318,'127.0.0.1',()=>console.log('Synthetic QA http://127.0.0.1:4318'));
