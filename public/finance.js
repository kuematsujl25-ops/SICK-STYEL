// Imported AI COO report, held in memory only. No network or persistence.
const money=['revenue_jpy','cogs_jpy','fees_jpy','shipping_jpy','packaging_jpy','returns_jpy','advertising_jpy'];
const derived=['gross_profit_jpy','contribution_profit_jpy','gross_margin','contribution_margin','profit_per_unit_jpy','profit_per_order_jpy','average_order_jpy'];
const allowedTop=['version','business_unit','source','fetched_at','period','timezone','currency','status','totals','skus','limitations'];
const keys=(v,allowed)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
const text=v=>typeof v==='string'&&v.length>0&&v.length<=1000;
const finite=v=>v===null||typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=Number.MAX_SAFE_INTEGER;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT/.test(v)&&Number.isFinite(Date.parse(v));
function stats(s){
 if(!keys(s,[...money,...derived,'units','orders','sku','inventory_units','promotion_status'])||![...money,...derived].every(k=>k in s&&finite(s[k]))||!['units','orders'].every(k=>Number.isSafeInteger(s[k])&&s[k]>=0))return false;
 if(!money.every(k=>s[k]===null||Number.isSafeInteger(s[k])&&s[k]>=0))return false;
 const gross=s.revenue_jpy===null||s.cogs_jpy===null?null:s.revenue_jpy-s.cogs_jpy;
 const contribution=gross===null||money.slice(2).some(k=>s[k]===null)?null:gross-money.slice(2).reduce((a,k)=>a+s[k],0);
 return s.gross_profit_jpy===gross&&s.contribution_profit_jpy===contribution;
}
export function validateFinanceReport(r){
 if(!keys(r,allowedTop)||r.version!==1||r.business_unit!=='sickstyle'||r.currency!=='JPY'||r.timezone!=='Asia/Tokyo'||!text(r.source)||!timestamp(r.fetched_at)||!keys(r.period,['start','end'])||!timestamp(r.period.start)||!timestamp(r.period.end)||Date.parse(r.period.start)>=Date.parse(r.period.end)||!['analyzed','no_data'].includes(r.status)||!Array.isArray(r.skus)||r.skus.length>10000||!Array.isArray(r.limitations)||!r.limitations.every(text))throw Error('SICK STYLEの利益レポート形式を確認してください。');
 if(r.status==='no_data'){if(r.totals!==null||r.skus.length)throw Error('未取得データの形式が不正です。');return r;}
 const seen=new Set();
 if(!stats(r.totals)||!r.skus.length)throw Error('利益の集計値を確認してください。');
 for(const s of r.skus){
  if(!stats(s)||!text(s.sku)||seen.has(s.sku)||!(s.inventory_units===null||Number.isSafeInteger(s.inventory_units)&&s.inventory_units>=0)||!['investigate_inventory','hold_stock','investigate_costs','hold_profit','candidate'].includes(s.promotion_status))throw Error('SKUの形式・重複を確認してください。');
  const expected=s.inventory_units===null?'investigate_inventory':s.inventory_units===0?'hold_stock':s.contribution_profit_jpy===null?'investigate_costs':s.contribution_profit_jpy<=0?'hold_profit':'candidate';
  if(s.promotion_status!==expected)throw Error('利益・在庫と販促可否が一致しません。');seen.add(s.sku);
 }
 for(const k of [...money,'units']){const total=r.skus.some(s=>s[k]===null)?null:r.skus.reduce((n,s)=>n+s[k],0);if(total!==r.totals[k])throw Error('SKUと合計が一致しません。');}
 return r;
}
export const financeStatus={candidate:'販促候補',hold_stock:'在庫なし',hold_profit:'利益改善を優先',investigate_costs:'費用の確認待ち',investigate_inventory:'在庫の確認待ち'};
export function renderFinance(r,esc){
 const yen=v=>v===null?'未取得':'¥'+v.toLocaleString('ja-JP',{maximumFractionDigits:0});
 const stamp=v=>esc(new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}));
 return `<section class="financehero"><div><div class="eyebrow">PROFIT & INVENTORY</div><h2>売上の先にある、利益を見渡す。</h2><p>商品ごとの採算と在庫を確認し、次の販促を選びます。</p></div><label class="primary filelabel">利益レポートを読み込む<input id="financefile" class="sr-only" type="file" accept="application/json,.json"></label></section>
 <p class="note">AI COOが作成したJSONを確認できます。ファイルは送信されません。ログアウト・再読み込みで表示を消去します。</p>
 ${!r?'<section class="panel financeempty"><span class="eyebrow">READY WHEN YOU ARE</span><h2>利益レポートは未取得です</h2><p>注文商品ごとの原価・送料・手数料が揃うと、貢献利益を比較できます。未入力の費用は「未取得」として扱います。</p></section>':`
 <section class="panel"><div class="panelhead"><h2>集計対象</h2><button id="financeclear" class="secondary">表示を消去</button></div><p>取得元: ${esc(r.source)}<br>取得日時: ${stamp(r.fetched_at)}<br>対象期間（日本時間）: ${stamp(r.period.start)} 〜 ${stamp(r.period.end)}（終了時刻を含まない）</p><p class="note">読み込んだファイルの集計値です。実際の費用・データの鮮度は取得元で確認してください。</p></section>
 <div class="stats financestats">${[['売上','revenue_jpy'],['粗利','gross_profit_jpy'],['貢献利益','contribution_profit_jpy']].map(([label,key])=>`<article><small>${label}</small><strong>${r.totals?yen(r.totals[key]):'未取得'}</strong><span>${key==='gross_profit_jpy'?'売上 − 原価':key==='contribution_profit_jpy'?'粗利 − 手数料・送料・梱包・返品・広告費':'入力された注文商品行の合計'}</span></article>`).join('')}</div>
 <section class="panel"><div class="panelhead"><h2>商品別の採算</h2><label>表示対象<select id="financefilter"><option value="all">すべての商品</option><option value="candidate">販促候補</option><option value="attention">確認が必要</option></select></label></div>
 <div class="financetable" tabindex="0" role="region" aria-label="商品別利益と在庫"><table><thead><tr><th scope="col">SKU</th><th scope="col">売上</th><th scope="col">粗利</th><th scope="col">貢献利益</th><th scope="col">在庫</th><th scope="col">販促の検討</th></tr></thead><tbody>${r.skus.map(s=>`<tr data-profit-status="${s.promotion_status}"><th scope="row">${esc(s.sku)}</th><td>${yen(s.revenue_jpy)}</td><td>${yen(s.gross_profit_jpy)}</td><td>${yen(s.contribution_profit_jpy)}</td><td>${s.inventory_units===null?'未取得':s.inventory_units.toLocaleString('ja-JP')}</td><td><span class="badge ${s.promotion_status==='candidate'?'ok':'warn'}">${financeStatus[s.promotion_status]}</span></td></tr>`).join('')}</tbody></table></div><p id="financecount" class="note">${r.skus.length} 商品</p></section>
 <section class="panel"><h2>判断に使う前に</h2><ul>${r.limitations.map(l=>`<li>${esc(l)}</li>`).join('')}</ul><p>利益の根拠がない施策や在庫切れの商品は、販促を進める前に調査してください。</p></section>`}`;
}
