// Pure calculations shared by the Worker and UI. No model or network calls.
const DAY=86400000;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const date=t=>new Date(t+9*3600000).toISOString().slice(0,10);
const shift=(s,n)=>new Date(Date.parse(s)+n*DAY).toISOString().slice(0,10);
const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const text=v=>typeof v==='string'?v.slice(0,500):null;
export function productSnapshot(orders){
 const rows=[],seenOrders=new Set();let duplicates=0,invalid=0;
 for(const o of orders){
  if(!o?.orderId||seenOrders.has(o.orderId)){duplicates++;continue;}seenOrders.add(o.orderId);
  const time=Date.parse(o.createdTime);const status=o.fulfillment?.fulfillmentStatus;
  if(!Number.isFinite(time)||!Array.isArray(o.orderItems)||!o.orderItems.length){invalid++;continue;}
  const seenItems=new Set();
  for(const i of o.orderItems){
   if(!i.orderItemId||seenItems.has(i.orderItemId)){duplicates++;continue;}seenItems.add(i.orderItemId);
   if(rows.length>=5000){invalid++;continue;}
   const p=i.product||{},quantity=Number.isSafeInteger(i.quantityOrdered)&&i.quantityOrdered>=0?i.quantityOrdered:null;
   const amounts=i.proceeds?.breakdowns?.filter(x=>x.type==='ITEM')||[];
   const m=amounts.length===1?amounts[0].subtotal:null;
   const amount=m?.currencyCode==='JPY'&&(typeof m.amount==='number'||typeof m.amount==='string'&&m.amount.trim()!=='')&&num(Number(m.amount))?Number(m.amount):null;
   if(quantity===null||(!p.sellerSku&&!p.asin))invalid++;
   // Explicit allowlist: no buyer, address, customization, serial number or raw response.
   rows.push({date:date(time),sku:text(p.sellerSku),asin:text(p.asin),title:text(p.title),quantity,amount,status:text(status),orderKey:text(o.orderId),itemKey:text(i.orderItemId)});
  }
 }
 return {version:1,rows,duplicates,invalid};
}
export function analyzeAmazon(cache,now=new Date().toISOString()){
 const today=date(Date.parse(now)),end=shift(today,-1),start=shift(today,-7),previousStart=shift(today,-14),previousEnd=shift(today,-8);
 const period={start,end,previousStart,previousEnd,timeZone:'Asia/Tokyo'};
 const fresh=stamp=>{const age=Date.parse(now)-Date.parse(stamp);return Number.isFinite(age)&&age>=0&&age<=36*3600000;};
 const daily=cache?.daily||[],counts=new Map();for(const r of daily)counts.set(r.date,(counts.get(r.date)||0)+1);
 function total(from,to,key){const days=Array.from({length:7},(_,i)=>shift(from,i));return days.every(d=>counts.get(d)===1&&num(daily.find(r=>r.date===d)?.[key]))?days.reduce((n,d)=>n+daily.find(r=>r.date===d)[key],0):null;}
 const metrics=Object.fromEntries(['sales','orders','units'].map(k=>{const current=total(start,end,k),previous=total(previousStart,previousEnd,k);return [k,{current,previous,delta:current!==null&&previous!==null?current-previous:null}];}));
 const salesFresh=fresh(cache?.salesSyncedAt)&&!cache?.salesError&&!cache?.error;
 const p=cache?.products,op=cache?.ordersPeriod;
 const productComplete=!!(p?.version===1&&Array.isArray(p.rows)&&p.invalid===0&&p.duplicates===0&&!cache.ordersTruncated&&validDate(op?.start)&&validDate(op?.end)&&op.start<=previousStart&&op.end>=end);
 const productsFresh=fresh(cache?.ordersSyncedAt)&&!cache?.ordersError&&!cache?.error;
 const grouped=new Map();
 for(const r of p?.rows||[]){
  if(!validDate(r.date)||r.date<previousStart||r.date>end||!r.sku&&!r.asin)continue;
  const key=JSON.stringify([r.sku,r.asin]);if(!grouped.has(key))grouped.set(key,{sku:r.sku,asin:r.asin,title:r.title,current:[],previous:[]});grouped.get(key)[r.date>=start?'current':'previous'].push(r);
 }
 const summarize=rows=>{
  const active=rows.filter(r=>['UNSHIPPED','PARTIALLY_SHIPPED','SHIPPED'].includes(r.status));
  const unknown=rows.some(r=>!['UNSHIPPED','PARTIALLY_SHIPPED','SHIPPED','CANCELLED','PENDING','PENDING_AVAILABILITY','UNFULFILLABLE'].includes(r.status));
  const sum=k=>productComplete&&!unknown&&active.every(r=>num(r[k]))?active.reduce((n,r)=>n+r[k],0):null;
  return {units:sum('quantity'),sales:sum('amount'),orders:productComplete&&!unknown?new Set(active.map(r=>r.orderKey)).size:null,cancelled:rows.filter(r=>r.status==='CANCELLED').length,pending:rows.filter(r=>['PENDING','PENDING_AVAILABILITY'].includes(r.status)).length};
 };
 const products=[...grouped.values()].map(g=>{const current=summarize(g.current),previous=summarize(g.previous);return {...g,current,previous,delta:current.units!==null&&previous.units!==null?current.units-previous.units:null,salesDelta:current.sales!==null&&previous.sales!==null?current.sales-previous.sales:null};}).sort((a,b)=>(b.current.units??-1)-(a.current.units??-1));
 const findings=[];
 if(!salesFresh||Object.values(metrics).some(v=>v.current===null||v.previous===null))findings.push({key:'sales-data',priority:'高',title:'売上比較の根拠を確認',analysis:'日別データに欠損・取得失敗・36時間超過の可能性があります。欠損を0に補完しません。',action:'Amazon同期の成功時刻と直近14日の日別値を確認する。'});
 else if(metrics.sales.delta<0)findings.push({key:'sales-decline',priority:'高',title:'直近7日の売上減少を確認',analysis:`注文商品売上は前7日から${metrics.sales.delta}円、販売個数は${metrics.units.delta}個、注文数は${metrics.orders.delta}件の差です。原因は未確認です。`,action:'商品別の数量差を確認し、販売減の商品について在庫・掲載状態を調査する。広告や価格変更は承認後に判断する。'});
 if(!productComplete||!productsFresh)findings.push({key:'product-data',priority:'高',title:'商品別内訳の不足を確認',analysis:'商品明細が未取得・一部取得・重複・古い状態です。商品別合計を確定しません。',action:'既存Amazon同期を確認する。商品明細・期間・重複を確認し、未取得の金額を0に置換しない。'});
 else for(const p of products.filter(p=>p.delta<0).sort((a,b)=>a.delta-b.delta).slice(0,3))findings.push({key:'product-decline:'+JSON.stringify([p.sku,p.asin]),priority:'中',title:`販売個数の減少：${p.title||p.sku||p.asin}`,analysis:`${p.previous.units}個 → ${p.current.units}個（差 ${p.delta}個）。注文数 ${p.previous.orders}件 → ${p.current.orders}件。原因・返品影響は未確認です。`,action:'対象商品の在庫切れ・掲載状態・商品ページの情報を確認し、改善案を準備する。価格・広告費は変更しない。'});
 return {period,metrics,products,salesFresh,productsFresh,productComplete,salesSyncedAt:cache?.salesSyncedAt??null,ordersSyncedAt:cache?.ordersSyncedAt??null,duplicates:p?.duplicates??null,invalid:p?.invalid??null,truncated:cache?.ordersTruncated??null,findings};
}
export function renderAmazonAnalysis(a,esc){
 if(!a)return '';
 const n=v=>v===null?'未取得':Number(v).toLocaleString('ja-JP');
 return `<section class="panel"><h2>Amazon 数値からの業務分析</h2><p>${esc(a.period.start)}〜${esc(a.period.end)} ／ 比較 ${esc(a.period.previousStart)}〜${esc(a.period.previousEnd)}（日本時間・各7日、当日除外）</p><p>売上取得 ${esc(a.salesSyncedAt||'未取得')} ／ 商品取得 ${esc(a.ordersSyncedAt||'未取得')}</p><p role="status">売上：${a.salesFresh?'36時間以内の取得':'古い・未取得・失敗'} ／ 商品内訳：${a.productComplete&&a.productsFresh?'期間の取得完了':'未取得・一部取得・古いデータ（合計は参考または未取得）'}</p><div class="tablewrap"><table class="data"><thead><tr><th>Sales API</th><th>直近7日</th><th>前7日</th><th>差</th></tr></thead><tbody>${Object.entries({sales:'注文商品売上（円）',orders:'注文数（件）',units:'販売個数（個）'}).map(([k,l])=>`<tr><th>${l}</th><td>${n(a.metrics[k].current)}</td><td>${n(a.metrics[k].previous)}</td><td>${n(a.metrics[k].delta)}</td></tr>`).join('')}</tbody></table></div><h3>何が何個売れたか</h3><p>Orders API・キャンセル／保留／発送不能を販売数から除外。返品・返金は未取得です。商品金額はITEM小計（JPY）のみで、Sales APIや入金額とは別指標です。</p>${a.products.length?`<div class="tablewrap"><table class="data"><thead><tr><th>商品 / SKU / ASIN</th><th>個数：前→今回（差）</th><th>注文数：前→今回</th><th>商品金額：前→今回（差・円）</th><th>キャンセル / 保留 明細数（今回）</th></tr></thead><tbody>${a.products.map(p=>`<tr><th>${esc(p.title||'商品名未取得')}<br>${esc(p.sku||'SKU未取得')}<br>${esc(p.asin||'ASIN未取得')}</th><td>${n(p.previous.units)} → ${n(p.current.units)} (${n(p.delta)})</td><td>${n(p.previous.orders)} → ${n(p.current.orders)}</td><td>${n(p.previous.sales)} → ${n(p.current.sales)} (${n(p.salesDelta)})</td><td>${n(p.current.cancelled)} / ${n(p.current.pending)}</td></tr>`).join('')}</tbody></table></div>`:'<p>商品明細は未取得、または期間内に商品明細がありません。次回同期で確認します。</p>'}<p>重複除外 ${n(a.duplicates)}件・不正/欠損 ${n(a.invalid)}件・取得上限 ${a.truncated===true?'到達':a.truncated===false?'未到達':'未確認'}</p><h3>課題候補と次の行動</h3>${a.findings.map(f=>`<article class="record"><h4>${esc(f.title)}（優先度 ${esc(f.priority)}）</h4><p>${esc(f.analysis)}</p><p>${esc(f.action)}</p></article>`).join('')||'<p>今回のルールに該当する課題はありません。課題がないことを保証するものではありません。</p>'}<p class="note">広告・原価・セッション・返品はこの分析に未取得。ROAS・利益・転換率は推測しません。売上は入金ではありません。外部AIへの商品・売上明細送信はOFFです。</p></section>`;
}
