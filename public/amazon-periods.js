// 依存なしの純粋関数。integrations/amazon.js（サーバー）とpublic/app.js（ブラウザー）の両方から読み込む
// （lib/runtime.jsはnode:async_hooksに依存しブラウザーで読み込めないため、期間計算だけここに分離する）。

// Sales APIは常に直近31日分しか返さないため、月をまたぐと先月分が窓から外れて失われる。
// 同期のたびに日付をキーにマージして蓄積し、月次推移・前月同期間比較に使える長期履歴を保つ（最大2年）。
export function mergeDailyHistory(oldHistory,newDaily){
 const byDate=new Map((oldHistory||[]).map(d=>[d.date,d]));
 for(const d of newDaily||[])byDate.set(d.date,d);
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-730);
}
export function daysInMonth(month){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).getUTCDate();}
// 完了済みの月はその月の全日数がhistoryに揃っていない限りnull（欠損を0円で埋めない）。
// 進行中の月（today指定時）は、現在までの経過日数ぶんだけ揃っていれば「未完了」として実数を返す。
export function monthlyTotals(history,months,today){
 const currentMonth=today?today.slice(0,7):null;
 return months.map(month=>{
  const rows=(history||[]).filter(d=>d.date.startsWith(month));
  const isCurrent=month===currentMonth;
  const expected=isCurrent?Number(today.slice(8,10)):daysInMonth(month);
  const complete=rows.length>=expected&&rows.every(d=>typeof d.sales==='number'&&Number.isFinite(d.sales));
  return {month,sales:complete?rows.reduce((n,d)=>n+d.sales,0):null,daysCovered:rows.length,daysExpected:expected,incomplete:isCurrent,partial:!isCurrent&&rows.length>0&&rows.length<expected};
 });
}
// 直近N か月の年月文字列（今月を含む、古い順）。
export function recentMonths(today,n=12){
 const [y,m]=today.slice(0,7).split('-').map(Number);
 const out=[];
 for(let i=n-1;i>=0;i--){const d=new Date(Date.UTC(y,m-1-i,1));out.push(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'));}
 return out;
}
export function addMonths(ym,delta){const [y,m]=ym.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
export function sourceLabel(src){return {api:'Sales API（自動同期）',manual:'手入力・CSV',mixed:'Sales API＋手入力（混在）',api_partial:'API一部取得（未確定）',partial:'一部のみ取得（未確定）',missing:'未取得'}[src]||src;}
// 指定した月の日別行を、API日次履歴（優先）と手入力/CSVのmetricsで日付ごとにマージする。
// 全部または何もない、ではなく「APIがある日はAPI、ない日だけ手入力で埋める」。
export function dailyRowsForMonth(c,metrics,targetMonth){
 const apiByDate=new Map((c?.dailyHistory||[]).filter(x=>x.date.startsWith(targetMonth)).map(x=>[x.date,x]));
 const manualByDate=new Map((metrics||[]).filter(m=>m.date.startsWith(targetMonth)).map(m=>[m.date,m]));
 const dates=new Set([...apiByDate.keys(),...manualByDate.keys()]);
 // APIの履歴行は存在するが売上がnull（例: 取得できなかった日・非JPY通貨の除外等）のことがあり、その場合は
 // 手入力/CSVの値があればそちらを優先する。「行がある＝API値を信頼してよい」ではない（Codex独立レビュー指摘。
 // todaySalesInfo()は既に同じ優先順位で正しく判定しており、ここを合わせる）。
 return [...dates].sort().map(date=>{
  const a=apiByDate.get(date);if(a&&typeof a.sales==='number')return {date,value:a.sales,source:'api'};
  const m=manualByDate.get(date);if(m&&Number.isFinite(m.sales))return {date,value:m.sales,source:'manual'};
  return {date,value:null,source:a?'api_partial':'missing'};
 });
}
// 月の合計は「API日次履歴 ∪ 手入力/CSV」の日別マージ（dailyRowsForMonthと同じ基準）で求める。
// 片方だけの合計を比較して採用するのではなく、1日単位でAPI優先・欠けている日だけ手入力で埋めた上で、
// 対象月の日数（進行中の月なら経過日数）を過不足なく揃っている場合に限り実数を返す（部分データを月合計として確定させない）。
export function monthSalesInfo(c,metrics,targetMonth,t){
 const isCurrent=t?targetMonth===t.slice(0,7):false;
 const expected=isCurrent?Number(t.slice(8,10)):daysInMonth(targetMonth);
 const rows=dailyRowsForMonth(c,metrics,targetMonth).filter(r=>Number(r.date.slice(8,10))<=expected);
 const complete=rows.length>=expected&&rows.every(r=>r.value!==null);
 if(complete){
  const sources=new Set(rows.map(r=>r.source));
  const source=sources.size===1?[...sources][0]:'mixed';
  return {value:rows.reduce((n,r)=>n+r.value,0),source,incomplete:isCurrent,daysCovered:rows.length,daysExpected:expected};
 }
 return {value:null,source:rows.some(r=>r.value!==null)?'partial':'missing',incomplete:false,daysCovered:rows.filter(r=>r.value!==null).length,daysExpected:expected};
}
export function todaySalesInfo(c,metrics,t){
 const apiRow=(c?.dailyHistory||[]).find(x=>x.date===t);
 if(apiRow&&typeof apiRow.sales==='number')return {value:apiRow.sales,source:'api'};
 const manualRow=(metrics||[]).find(m=>m.date===t);
 if(manualRow&&Number.isFinite(manualRow.sales))return {value:manualRow.sales,source:'manual'};
 return {value:null,source:apiRow?'api_partial':'missing'};
}
// 日別グラフ表示専用：対象月の暦日すべて（進行中の月は経過日まで）に1本ずつ行を作る。
// dailyRowsForMonthはデータのある日だけを返す（集計用）ため、グラフでは欠けている日も
// 「missing」として明示的に描画できるよう、ここで暦日の抜けを埋める。
export function fullMonthRows(c,metrics,targetMonth,t){
 const isCurrent=t?targetMonth===t.slice(0,7):false;
 const lastDay=isCurrent?Number(t.slice(8,10)):daysInMonth(targetMonth);
 const byDate=new Map(dailyRowsForMonth(c,metrics,targetMonth).map(r=>[r.date,r]));
 const out=[];
 for(let day=1;day<=lastDay;day++){const date=targetMonth+'-'+String(day).padStart(2,'0');out.push(byDate.get(date)||{date,value:null,source:'missing'});}
 return out;
}
export function priorPeriodSales(c,metrics,targetMonth,throughDay){
 const priorMonth=addMonths(targetMonth,-1);
 // 対象月のほうが前月より日数が多い場合（例: 3月31日時点 vs 2月）、前月には存在しない日数までは
 // 比較しようがない。前月の実際の日数で上限を揃える（Codex独立レビュー指摘：以前はthroughDayそのものを
 // 要求していたため、月の長さが異なる組み合わせでは前月データが揃っていても常に「未取得」になっていた）。
 const expected=Math.min(throughDay,daysInMonth(priorMonth));
 const rows=dailyRowsForMonth(c,metrics,priorMonth).filter(r=>Number(r.date.slice(8,10))<=expected);
 const complete=rows.length===expected&&rows.every(r=>r.value!==null);
 return {month:priorMonth,value:complete?rows.reduce((n,r)=>n+r.value,0):null,daysCovered:rows.filter(r=>r.value!==null).length,daysExpected:expected};
}
// ROAS = 広告経由売上 ÷ 広告費。分母が0・未取得、または分子が未取得ならnull（＝「計算不可」）。総売上は使わない。
export function adRoas(ad){if(!ad.adCost||ad.adCost<=0||ad.attributedSales===null)return null;return Math.round(ad.attributedSales/ad.adCost*100)/100;}
// ACOS = 広告費 ÷ 広告経由売上 × 100（%）。分母が0・未取得、または広告費が未取得ならnull。
export function adAcos(ad){if(ad.attributedSales===null||ad.attributedSales<=0||ad.adCost===null)return null;return Math.round(ad.adCost/ad.attributedSales*1000)/10;}
