export const TYPES={dm:'DM送信',reply:'返信',appointment:'初回Zoom予約獲得',zoom:'初回Zoom実施',sent:'発送',arrived:'到着',second:'2回目Zoom実施',order:'受注',complete:'月内入力完了確認',void:'記録取消'};
export const day=at=>/^\d{4}-\d{2}-\d{2}$/.test(at)?at:new Date(at).toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export function kpiQuality(facts,month,orgs=[]){
 const issues=[];
 const groups=[...new Set(facts.map(r=>r.party))].map(p=>facts.filter(r=>r.party===p).sort((a,b)=>a.date.localeCompare(b.date)));
 for(const g of groups){
  const first=t=>g.find(r=>r.type===t);
  if(!g.some(r=>r.date.startsWith(month))&&!first('dm')?.date.startsWith(month))continue;
  const warn=(code,ids)=>issues.push({code,ids});
  if(!first('dm'))warn('初回DM日が未記録（非DM起点の案件か、履歴不足かを確認）',g.map(r=>r.id));
  for(const [a,b] of [['dm','reply'],['dm','appointment'],['dm','zoom'],['dm','order'],['reply','zoom'],['reply','second'],['zoom','order']]){
   const start=first(a),end=first(b);
   if(start&&end&&end.date<start.date)warn(`${TYPES[b]}が${TYPES[a]}より前`,[start.id,end.id]);
  }
  for(const type of ['appointment','zoom','second'])if(first(type)&&!first('reply'))warn(`${TYPES[type]}の返信日が未記録（工程省略か履歴不足かを確認）`,[first(type).id]);
  for(const shipment of new Set(g.filter(r=>['sent','arrived'].includes(r.type)).map(r=>r.deal))){
   const sent=g.find(r=>r.type==='sent'&&r.deal===shipment),arrived=g.find(r=>r.type==='arrived'&&r.deal===shipment);
   if(arrived&&!sent)warn('到着に対応する発送日が未記録',[arrived.id]);
   if(arrived&&sent&&arrived.date<sent.date)warn('到着が発送より前',[sent.id,arrived.id]);
  }
 }
 const legacyMissingDm=orgs.filter(o=>!facts.some(r=>r.party===o.id&&r.type==='dm')).length;
 const stages=Object.entries(TYPES).filter(([t])=>!['complete','void'].includes(t)).map(([type,label])=>({type,label,recorded: new Set(facts.filter(r=>r.type===type&&r.date.startsWith(month)).map(r=>r.party)).size}));
 return {issues,legacyMissingDm,stages,blocked:issues.length>0||legacyMissingDm>0};
}
export function computeKpi(records,month,now=new Date().toISOString(),orgs=[]){
 const voids=new Set(records.filter(r=>r.type==='void'&&r.date<=day(now)).map(r=>r.ref));
 const active=records.filter(r=>!voids.has(r.id)&&r.type!=='void'&&r.date<=day(now)).sort((a,b)=>a.date.localeCompare(b.date));
 const facts=active.filter(r=>r.type!=='complete'),within=r=>r.date.startsWith(month),complete=active.some(r=>r.type==='complete'&&within(r));
 const groups=[...new Set(facts.map(r=>r.party))].map(p=>facts.filter(r=>r.party===p));
 const first=(g,t)=>g.find(r=>r.type===t),cohort=groups.filter(g=>first(g,'dm')&&within(first(g,'dm')));
 const counts=Object.fromEntries(['dm','reply','appointment','zoom'].map(t=>[t,groups.filter(g=>first(g,t)&&within(first(g,t))).length]));
 const orders=facts.filter(r=>r.type==='order'&&within(r));counts.order=orders.length;
 const rates=[['返信率','reply','dm',20],['DM→アポ獲得率','appointment','dm',null],['初回面着率','zoom','reply',50],['DM→初回Zoom実施率','zoom','dm',10],['受注率','order','zoom',10],['DM→受注率','order','dm',1]].map(([label,num,den,target])=>{const base=cohort.filter(g=>first(g,den)&&first(g,den).date>=first(g,'dm').date),n=base.filter(g=>g.some(r=>r.type===num&&r.date>=first(g,den).date)).length;return {label,num,den,target,n,d:base.length,value:base.length?n/base.length*100:null};});
 const lt=(a,b)=>{const samples=a==='sent'?[...new Set(facts.filter(r=>['sent','arrived'].includes(r.type)&&r.deal).map(r=>JSON.stringify([r.party,r.deal])))].map(key=>facts.filter(r=>JSON.stringify([r.party,r.deal])===key)):groups;const pairs=samples.map(g=>{const e=first(g,b),s=first(g,a);return e&&s&&within(e)&&e.date>=s.date?(Date.parse(e.date)-Date.parse(s.date))/86400000:null;}).filter(x=>x!==null);return {count:pairs.length,value:pairs.length?pairs.reduce((a,b)=>a+b,0)/pairs.length:null};};
 const quality=kpiQuality(facts,month,orgs);
 const direct=orders.filter(r=>r.channel==='direct');return {counts,rates,complete,quality,usable:complete&&!quality.blocked,facts,orders,revenue:complete&&!quality.blocked&&!orders.some(r=>r.channel==='unknown')&&direct.every(r=>r.amount!==null)?direct.reduce((a,r)=>a+r.amount,0):null,lt:{zoom:lt('dm','zoom'),shipping:lt('sent','arrived'),second:lt('reply','second')}};
}
const fmt=v=>v===null?'未取得':Number(v).toLocaleString('ja-JP',{maximumFractionDigits:1});
const formatLt=lt=>lt.count?`${fmt(lt.value)}日（実測 ${lt.count}組）`:'未測定（有効な日付ペア0組）';
export function renderKpi(records,month,orgs,amazon,esc){
 const k=computeKpi(records,month,new Date().toISOString(),orgs);
 const table=(heads,rows)=>`<div class="tablewrap"><table class="data"><thead><tr>${heads.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 return `<section class="panel"><div class="panelhead"><h2>月次営業KPI</h2><button data-nav="orgSales">団体一覧</button></div><label>対象月<input type="month" id="kpimonth" value="${esc(month)}"></label><p>新規DM200 → 返信40 → 初回Zoom実施20 → 受注2件。日本時間。売上目標は未設定。当月は進行中の集計です。</p><p>${k.complete?'月内入力完了は利用者の自己申告です。外部ソースの網羅性は未検証です。':'未取得・入力途中。記録なしを確定0件とは扱いません。'}${k.quality.blocked?' 未解決の履歴不足・品質警告があるため実績の確定表示を保留します。':''}</p>${table(['月内活動','目標','実績','達成率','差'],Object.entries({dm:200,reply:40,zoom:20,order:2}).map(([t,target])=>[TYPES[t],target,k.usable?k.counts[t]:`未取得（記録済み ${k.counts[t]}）`,k.usable?fmt(k.counts[t]/target*100)+'%':'未確定',k.usable?k.counts[t]-target:'未確定']))}<p>DMは最初の送信月に送信先IDごと1件。追送は新規200件に含みません。返信・予約・実施は初回の月に各送信先1件。予約獲得は記録済み${k.counts.appointment}件。予定だけで実施扱いしません。受注は案件IDごと1件（再受注は新しい案件ID）。商品個数とは別です。</p></section>
 <section class="panel"><h2>初回DM月の追跡</h2><p>${esc(month)}に初回DMを送った先を現在まで追跡。月内活動数とは別の、記録ベースの暫定率です。未成熟案件を失注とみなしません。</p>${table(['指標','目標','分子 / 分母（送信先数）','暫定実績','達成率 / 差'],k.rates.map(r=>[r.label,r.target===null?'未設定':r.target+'%',`${r.n} / ${r.d}（${TYPES[r.num]} / ${TYPES[r.den]}）`,k.quality.blocked?'算出保留（品質確認）':r.value===null?'算出不可（母数0）':fmt(r.value)+'%',k.quality.blocked||r.value===null||r.target===null?'算出不可':fmt(r.value/r.target*100)+'% / '+fmt(r.value-r.target)+'pt']))}<p>受注率10%の母数は初回Zoom実施先という仮定。分母の活動日以後に分子の活動がある先を計上します。途中の返信記録が不足すると正確な率は測定できません。</p></section>
 <section class="panel"><h2>売上・データ品質</h2><p>Amazon：${fmt(amazon)}円 ／ 団体直接売上：${fmt(k.revenue)}円。Amazon経由の受注を直接売上には足しません。販路・網羅性確認前の全体合計は未取得。</p><p>Amazonは注文日ベース・返品控除前。利益・入金ではありません。受注の販路未確認 ${k.orders.filter(r=>r.channel==='unknown').length}件、金額未入力 ${k.orders.filter(r=>r.amount===null).length}/${k.orders.length}件、商品個数未入力 ${k.orders.filter(r=>r.qty===null).length}/${k.orders.length}件。</p><p>初回DM日が未記録の既存団体 ${k.quality.legacyMissingDm}/${orgs.length}件（不足率 ${orgs.length?fmt(k.quality.legacyMissingDm/orgs.length*100)+'%':'算出不可'}）。段階変更日を返信・受注日には代用しません。この不足は対象月への帰属自体が未確認です。</p><h3>月別・工程別の記録状況</h3><p>以下は日付記録のある送信先数です。各工程の未発生と未入力は判別できず、記録が1件あっても工程全体の入力完了を意味しません。</p>${table(['工程','対象月の日付記録あり','入力網羅性'],k.quality.stages.map(s=>[s.label,s.recorded+'先','未検証']))}<h3>未解決の品質警告</h3>${k.quality.issues.length?'<ul>'+k.quality.issues.map(q=>'<li>'+esc(q.code)+'（記録ID '+q.ids.map(esc).join(', ')+'）</li>').join('')+'</ul>':'<p>日付の既知の矛盾はありません。履歴の完全性を保証するものではありません。</p>'}<h3>リードタイム（終点が対象月）</h3><p>初回DM→初回Zoom（起点は仮置き）：${formatLt(k.lt.zoom)}／想定4日。発送→到着：${formatLt(k.lt.shipping)}／想定2日。</p><p>DM返信→2回目Zoom：${formatLt(k.lt.second)}／想定12日（実数値ではありません）。4日・2日と単純加算しません。</p></section>
 <section class="panel"><h2>実際の活動日を記録</h2><p>同一団体は同じ送信先IDを使用。入力完了確認はその月の全活動を確認した場合のみの自己申告です。品質警告や既存履歴不足は確認後も残ります。訂正は取消後に再登録します。</p><form id="kpiform"><div class="formfields"><label>種類<select name="type">${Object.entries(TYPES).filter(([t])=>t!=='void').map(([t,l])=>`<option value="${t}">${l}</option>`).join('')}</select></label><label>活動日（JST）<input required type="date" name="date" max="${day(new Date().toISOString())}" value="${esc(month)}-01"></label><label>送信先ID<input name="party" maxlength="100" list="kpiparties"></label><datalist id="kpiparties">${orgs.map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</datalist><label>受注案件ID・発送ID（発送と到着は同じID）<input name="deal" maxlength="100"></label><label>受注金額（円・任意）<input name="amount" type="number" min="0" step="0.01"></label><label>商品個数（任意）<input name="qty" type="number" min="0" step="1"></label><label>受注販路<select name="channel"><option value="unknown">未確認</option><option value="direct">団体直接</option><option value="amazon">Amazon経由</option></select></label><label>根拠・メモ<input name="title" required maxlength="500"></label></div><button class="primary">記録する</button><p id="kpierror" role="alert"></p></form></section>
 <section class="panel"><h2>対象月の根拠履歴</h2>${records.filter(r=>r.date.startsWith(month)).map(r=>`<div class="listrow"><div class="grow"><b>${esc(TYPES[r.type])} ${esc(r.date)}</b><small>${esc(r.party)} ${esc(r.deal)} ${esc(r.title)} · 記録ID ${esc(r.id)}${r.ref?' · 取消対象 '+esc(r.ref):''}</small></div>${r.type!=='void'&&!records.some(v=>v.type==='void'&&v.ref===r.id)?`<button data-kpivoid="${esc(r.id)}">取消記録を追加</button>`:''}</div>`).join('')||'<p>未取得</p>'}</section>`;
}
