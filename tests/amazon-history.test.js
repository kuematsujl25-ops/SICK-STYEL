import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeDailyHistory,daysInMonth,monthlyTotals,addMonths,dailyRowsForMonth,fullMonthRows,monthSalesInfo,todaySalesInfo,priorPeriodSales,adRoas,adAcos} from '../public/amazon-periods.js';

const d=(date,sales,orders=1)=>({date,sales,currency:'JPY',orders,units:orders});

test('mergeDailyHistory accumulates across rolling 31-day windows instead of losing prior months', () => {
 const septWindow=[d('2026-09-01',100),d('2026-09-02',200)];
 const octWindow=[d('2026-10-01',300),d('2026-10-02',400)];
 const afterSept=mergeDailyHistory(null,septWindow);
 assert.deepEqual(afterSept.map(x=>x.date),['2026-09-01','2026-09-02']);
 // 10月の同期が来ても、9月のhistoryは消えずに残る（APIは直近31日しか返さないため）。
 const afterOct=mergeDailyHistory(afterSept,octWindow);
 assert.deepEqual(afterOct.map(x=>x.date),['2026-09-01','2026-09-02','2026-10-01','2026-10-02']);
});

test('mergeDailyHistory overwrites same-date entries with the newer sync (fresher data wins)', () => {
 const first=[d('2026-10-05',null)]; // 初回は未取得だった
 const second=[d('2026-10-05',500)]; // 再同期で取得できた
 const merged=mergeDailyHistory(first,second);
 assert.equal(merged.length,1);
 assert.equal(merged[0].sales,500);
});

test('mergeDailyHistory caps at ~2 years like the Instagram follower-history precedent', () => {
 const old=Array.from({length:800},(_,i)=>d('2024-01-'+String(1+(i%28)).padStart(2,'0')+'',i));
 const merged=mergeDailyHistory(null,old);
 assert.ok(merged.length<=730);
});

test('daysInMonth is correct across month lengths and does not need a leap-year special case for Feb 2026 (non-leap)', () => {
 assert.equal(daysInMonth('2026-01'),31);
 assert.equal(daysInMonth('2026-02'),28);
 assert.equal(daysInMonth('2026-04'),30);
 assert.equal(daysInMonth('2024-02'),29); // うるう年は別途
});

test('monthlyTotals never fills a completed-but-gappy past month with a plausible-looking total (missing != 0)', () => {
 const history=[d('2026-09-01',1000),d('2026-09-02',2000)]; // 9月は2日分しかない（28日欠損）
 const totals=monthlyTotals(history,['2026-09'],'2026-10-15');
 assert.equal(totals[0].sales,null,'欠損のある過去月の合計はnull（0円に見える合計を出さない）');
 assert.equal(totals[0].partial,true);
 assert.equal(totals[0].daysCovered,2);
 assert.equal(totals[0].daysExpected,30);
});

test('monthlyTotals returns a real total for a fully-covered past month', () => {
 const history=Array.from({length:30},(_,i)=>d('2026-09-'+String(i+1).padStart(2,'0'),1000));
 const totals=monthlyTotals(history,['2026-09'],'2026-10-15');
 assert.equal(totals[0].sales,30000);
 assert.equal(totals[0].partial,false);
 assert.equal(totals[0].incomplete,false);
});

test('monthlyTotals marks the current month as incomplete (running total so far), not missing', () => {
 const history=Array.from({length:10},(_,i)=>d('2026-10-'+String(i+1).padStart(2,'0'),1000));
 const totals=monthlyTotals(history,['2026-10'],'2026-10-10');
 assert.equal(totals[0].sales,10000,'進行中の月は、揃っている経過日数ぶんの実数を返す（0やnullで隠さない）');
 assert.equal(totals[0].incomplete,true);
 assert.equal(totals[0].partial,false);
});

test('monthlyTotals returns null when even the current month has a gap in already-elapsed days', () => {
 const history=[d('2026-10-01',1000),d('2026-10-03',1000)]; // 10/2が欠けている
 const totals=monthlyTotals(history,['2026-10'],'2026-10-05');
 assert.equal(totals[0].sales,null,'経過日数に満たない場合は未確定');
});

test('monthlyTotals with no history at all for a month returns null, not 0', () => {
 const totals=monthlyTotals([],['2025-01'],'2026-10-15');
 assert.equal(totals[0].sales,null);
 assert.equal(totals[0].daysCovered,0);
});

test('addMonths steps across year boundaries', () => {
 assert.equal(addMonths('2026-10',-1),'2026-09');
 assert.equal(addMonths('2026-01',-1),'2025-12');
 assert.equal(addMonths('2026-12',1),'2027-01');
});

test('dailyRowsForMonth prefers the API record over a manual record on the same date (per-day merge, not all-or-nothing)', () => {
 const c={dailyHistory:[d('2026-10-01',1000),d('2026-10-02',2000)]};
 const metrics=[{date:'2026-10-02',sales:9999},{date:'2026-10-03',sales:3000}]; // 10/2はAPIと重複→APIを優先、10/3はAPIがない日なので手入力で埋める
 const rows=dailyRowsForMonth(c,metrics,'2026-10');
 assert.deepEqual(rows,[
  {date:'2026-10-01',value:1000,source:'api'},
  {date:'2026-10-02',value:2000,source:'api'},
  {date:'2026-10-03',value:3000,source:'manual'},
 ]);
});

test('dailyRowsForMonth falls back to a manual value when the API has a row for that date but its sales is null (Codex独立レビュー指摘の回帰)', () => {
 // APIの日次履歴に行はあるが売上がnull（取得できなかった日・非JPY通貨の除外等）で、
 // 同じ日に手入力/CSVの実測値がある場合、nullのAPI行を優先して「未取得」と表示してはいけない。
 const c={dailyHistory:[d('2026-10-05',null)]};
 const metrics=[{date:'2026-10-05',sales:4200}];
 const rows=dailyRowsForMonth(c,metrics,'2026-10');
 assert.deepEqual(rows,[{date:'2026-10-05',value:4200,source:'manual'}]);
});
test('dailyRowsForMonth reports api_partial (not missing) when the API has a null-sales row and there is no manual fallback', () => {
 const rows=dailyRowsForMonth({dailyHistory:[d('2026-10-05',null)]},[],'2026-10');
 assert.deepEqual(rows,[{date:'2026-10-05',value:null,source:'api_partial'}]);
});

test('dailyRowsForMonth marks a day with neither API nor manual data as missing, not 0', () => {
 const rows=dailyRowsForMonth({dailyHistory:[d('2026-10-01',500)]},[],'2026-10');
 assert.equal(rows.length,1,'データのない日は行を作らない（0円の行を捏造しない）');
});

test('monthSalesInfo merges API and manual per day (API wins on overlap) and sums the whole month once every day is covered', () => {
 const c={dailyHistory:[d('2026-09-01',100)]}; // 9月はAPIでは1日分（9/1=100）のみ
 const metrics=Array.from({length:30},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),sales:1000})); // 手入力は全30日分（9/1も含む）
 const info=monthSalesInfo(c,metrics,'2026-09','2026-10-15');
 assert.equal(info.value,100+29*1000,'9/1はAPIの値(100)を採用し、残り29日は手入力(1000×29)で埋めた合計');
 assert.equal(info.source,'mixed');
 assert.equal(info.daysCovered,30);
});

test('monthSalesInfo falls back to a pure-manual total when the month is fully covered by manual records alone', () => {
 const metrics=Array.from({length:30},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),sales:1000}));
 const info=monthSalesInfo(null,metrics,'2026-09','2026-10-15');
 assert.equal(info.value,30000);
 assert.equal(info.source,'manual');
});

test('monthSalesInfo never treats a single partial day as the whole month\'s total (regression: a 1-day manual entry must not read as a confident monthly total)', () => {
 const metrics=[{date:'2026-10-22',sales:5000}]; // 10月は1日分しか記録がない
 const info=monthSalesInfo(null,metrics,'2026-10','2026-10-22');
 assert.equal(info.value,null,'29日分が欠けているため、1日分の5,000円を月合計として表示してはいけない');
 assert.equal(info.source,'partial');
 assert.equal(info.daysCovered,1);
 assert.equal(info.daysExpected,22,'進行中の月なので経過日数(22日)が期待値');
});

test('monthSalesInfo reports "partial" (not a fabricated total) when neither API nor manual data fully covers the month', () => {
 const c={dailyHistory:[d('2026-09-01',100),d('2026-09-02',100)]};
 const info=monthSalesInfo(c,[],'2026-09','2026-10-15');
 assert.equal(info.value,null);
 assert.equal(info.source,'partial');
});

test('monthSalesInfo reports "missing" when there is no data at all for the month', () => {
 const info=monthSalesInfo(null,[],'2025-01','2026-10-15');
 assert.equal(info.value,null);
 assert.equal(info.source,'missing');
});

test('todaySalesInfo prefers API for today, falls back to manual, else missing', () => {
 assert.deepEqual(todaySalesInfo({dailyHistory:[d('2026-10-05',700)]},[],'2026-10-05'),{value:700,source:'api'});
 assert.deepEqual(todaySalesInfo({dailyHistory:[]},[{date:'2026-10-05',sales:300}],'2026-10-05'),{value:300,source:'manual'});
 assert.equal(todaySalesInfo({dailyHistory:[]},[],'2026-10-05').value,null);
});

test('fullMonthRows renders one row per elapsed calendar day, marking days with no data as missing instead of omitting them (so the chart does not look like only 1 day exists)', () => {
 const rows=fullMonthRows({dailyHistory:[]},[{date:'2026-10-22',sales:5000}],'2026-10','2026-10-22');
 assert.equal(rows.length,22,'進行中の月なので経過日数(22日)ぶんの行がある');
 assert.equal(rows.filter(r=>r.value===null).length,21,'データのない21日はmissingとして可視化される');
 assert.deepEqual(rows.find(r=>r.date==='2026-10-22'),{date:'2026-10-22',value:5000,source:'manual'});
});

test('fullMonthRows for a past month renders the full calendar month length, not just elapsed days', () => {
 const rows=fullMonthRows({dailyHistory:[]},[],'2026-09','2026-10-15');
 assert.equal(rows.length,30);
 assert.ok(rows.every(r=>r.value===null));
});

test('priorPeriodSales compares the same elapsed-day range in the prior month, and requires full coverage of that exact range', () => {
 const sept=Array.from({length:30},(_,i)=>d('2026-09-'+String(i+1).padStart(2,'0'),1000));
 const oct=Array.from({length:10},(_,i)=>d('2026-10-'+String(i+1).padStart(2,'0'),2000));
 const c={dailyHistory:[...sept,...oct]};
 const prior=priorPeriodSales(c,[],'2026-10',10);
 assert.equal(prior.month,'2026-09');
 assert.equal(prior.value,10000,'前月の同じ日数（1〜10日）だけを合計する');
});

test('priorPeriodSales returns null when the prior period itself has gaps (never fabricates a comparison)', () => {
 const c={dailyHistory:[d('2026-09-01',1000),d('2026-09-03',1000)]}; // 9/2が欠損
 const prior=priorPeriodSales(c,[],'2026-10',3);
 assert.equal(prior.value,null);
});

test('adRoas/adAcos use ad-attributed sales, never total revenue, and return null ("計算不可") for a zero/missing denominator', () => {
 assert.equal(adRoas({adCost:10000,attributedSales:50000}),5,'ROAS = 広告経由売上 ÷ 広告費');
 assert.equal(adAcos({adCost:10000,attributedSales:50000}),20,'ACOS = 広告費 ÷ 広告経由売上 × 100（%）');
 assert.equal(adRoas({adCost:0,attributedSales:50000}),null,'広告費が0なら計算不可');
 assert.equal(adRoas({adCost:null,attributedSales:50000}),null,'広告費が未取得なら計算不可');
 assert.equal(adRoas({adCost:10000,attributedSales:null}),null,'広告経由売上が未取得なら計算不可');
 assert.equal(adAcos({adCost:10000,attributedSales:0}),null,'広告経由売上が0なら計算不可（0除算にしない）');
 assert.equal(adAcos({adCost:null,attributedSales:50000}),null);
});
