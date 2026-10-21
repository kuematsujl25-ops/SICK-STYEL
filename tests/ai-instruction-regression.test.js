// Offline contract and review-oracle tests. These do NOT test model compliance or approve output quality.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createJob,taskPacket,buildPrompt,validateOutput} from '../lib/ai-team.js';
import {FIXTURES,fixtureInput,fixtureInputHash} from '../scripts/ai-staff/eval-fixtures.js';
import {analysisPrompt,delegatePrompt,DELEGATES,agentDefinition} from '../scripts/ai-staff/delegate.js';
const read=name=>readFileSync(new URL('../scripts/ai-staff/agents/'+name+'.md',import.meta.url),'utf8');
const result=()=>({summary:'架空の型契約確認',fact_ids:[],missing_data:['前月売上'],hypotheses:[],recommendations:[{title:'確認',steps:['前月売上取得'],kpi:'前月売上（JPY）',estimated_profit_jpy:null,cost_jpy:null,effort_hours:null,evidence_ids:[],risks:['未取得']}],approvals_required:[],limitations:['架空データ、未採用']});
test('kpi配列/不正型を拒否し元JSONを補正しない。文字列とnull数値の契約は維持',()=>{
 assert.deepEqual(validateOutput(result(),[]),result());
 for(const kpi of [['前月売上（JPY）'],[],null,7,{value:'売上'},'']){const o=result();o.recommendations[0].kpi=kpi;const before=JSON.stringify(o);assert.throws(()=>validateOutput(o,[]));assert.equal(JSON.stringify(o),before);}
 for(const key of ['steps','risks']){const o=result();o.recommendations[0][key]='文字列';assert.throws(()=>validateOutput(o,[]));}
});
test('全30packetを変えず親単独/委譲/通常runnerへ共通文字列kpi契約を供給',()=>{
 for(const f of FIXTURES){const p=taskPacket(createJob(fixtureInput(f),'2026-10-01T00:00:00.000Z')),before=JSON.stringify(p);assert.equal(p.input_hash,fixtureInputHash(f));
 for(const text of [buildPrompt(p),analysisPrompt(p),delegatePrompt(p,f.delegate)]){assert.match(text,/kpi.*(?:string|文字列).*配列不可/);const embedded=text.split('<untrusted_task_data>\n')[1].split('\n</untrusted_task_data>')[0];assert.equal(embedded,before);}
 assert.equal(JSON.stringify(p),before);}
 for(const name of DELEGATES){const text=read(name);assert.match(text,/kpiは文字列（配列不可）/);assert.deepEqual(agentDefinition(name,text).tools,[]);assert.equal(text,readFileSync(new URL('../.claude/agents/'+name+'.md',import.meta.url),'utf8'));}
});
test('指示の全欄条件・費用一度・在庫時系列・既知単位時刻の要件が親/担当へ届く',()=>{
 const p=taskPacket(createJob(fixtureInput(FIXTURES[0]),'2026-10-01T00:00:00.000Z'));
 assert.match(analysisPrompt(p),/claim\/test.*steps\/kpi\/risks.*全field/);
 const profit=read('ss-profit-inventory');for(const term of ['(M2−M1)−(C2−C1)','C1=C2','返品調整後粗利','原価を再控除しません','広告費が控除済み','倍率','×100（%）','期間日数','分母0','予測在庫(t)','最初の不足日','0を下限','発注単位'])assert.ok(profit.includes(term),term);
 const data=read('ss-data-auditor');for(const term of ['3.2万円=32000円','JST 10/1 00:30','毎月1日','09:00未満','計算結果と別'])assert.ok(data.includes(term),term);
});
test('独立採点用の架空計算例: 控除一度/費用変化/返品戻し/比率の単位/ゼロ・欠測',()=>{
 // Review oracles only: no production calculator and no model output is rewritten.
 const subtotal=price=>price-900-price*0.15;assert.equal(subtotal(2480),1208);assert.equal(subtotal(1980),783);
 const delta=(c1,c2)=>subtotal(1980)-c2-(subtotal(2480)-c1);
 assert.equal(delta(100,100),-425);assert.equal(delta(100,300),-625);assert.equal(delta(600,100),75);
 // Original cost 4000, returned cost 800: adjusted cost=3200; don't restore it twice.
 const gross=(cost,alreadyAdjusted)=>10000-2000-(alreadyAdjusted?cost:cost-800);
 assert.equal(gross(4000,false),4800);assert.equal(gross(3200,true),4800);assert.equal(gross(3200,true)-500-700,3600);
 const ratio=(n,d,scale)=>n===null||d===null?'missing':d===0?'zero_denominator':n/d*scale;
 assert.equal(ratio(80000,20000,1),4);assert.equal(ratio(20000,80000,100),25);
 assert.equal(ratio(20000,0,100),'zero_denominator');assert.equal(ratio(0,20000,1),0);assert.equal(ratio(null,20000,1),'missing');
 assert.equal(45/30,1.5);assert.equal(0/(45/30),0);assert.equal(ratio(60,0,1),'zero_denominator');assert.equal(ratio(60,null,1),'missing');
});
test('独立採点用の在庫・日付境界例: 遅着入荷を先取りせず、増需要で不足が5日より延長',()=>{
 const firstShortage=(daily,arrival)=>{for(let day=1;day<=30;day++)if(60+(day>=arrival?60:0)-daily*day<0)return day;return null;};
 assert.equal(firstShortage(3,25),21);assert.equal(firstShortage(4,25),16);assert.equal(firstShortage(3,20),null);
 const candidate=(need,stock,timely,lot)=>Math.ceil(Math.max(0,need-stock-timely)/lot)*lot;
 assert.equal(candidate(10,20,0,5),0);assert.equal(candidate(25,10,3,5),15);
 const jst=utc=>new Date(Date.parse(utc)+9*3600000).toISOString();assert.equal(jst('2026-09-30T15:30:00Z'),'2026-10-01T00:30:00.000Z');
 const boundary=utc=>{const d=new Date(jst(utc));return d.getUTCDate()===1&&d.getUTCHours()<9;};
 assert.equal(boundary('2026-09-30T15:00:00Z'),true);assert.equal(boundary('2026-10-01T00:00:00Z'),false);assert.equal(boundary('2026-10-01T15:30:00Z'),false);
});

test('前月比: 基準月0でも差額は算出、倍率/増減百分率と欠測を区別する反例',()=>{
 const compare=(current,base)=>current===null||base===null?{status:'missing',difference:null,multiple:null,percent:null}:
  {status:base===0?'zero_denominator':'known',difference:current-base,multiple:base===0?null:current/base,percent:base===0?null:(current/base-1)*100};
 assert.deepEqual(compare(90000,0),{status:'zero_denominator',difference:90000,multiple:null,percent:null});
 assert.deepEqual(compare(0,0),{status:'zero_denominator',difference:0,multiple:null,percent:null});
 assert.deepEqual(compare(90000,null),{status:'missing',difference:null,multiple:null,percent:null});
 assert.deepEqual(compare(90000,60000),{status:'known',difference:30000,multiple:1.5,percent:50});
 assert.equal(compare(0,60000).percent,-100);
 const data=read('ss-data-auditor');for(const term of ['基準月0','差額は計算可能','増減率は算出不可','倍率','百分率'])assert.ok(data.includes(term),term);
});
test('利益上限: 非負手数料だけでは不十分、符号付き純調整の反例を保持',()=>{
 const profit=(gross,costs)=>costs.some(x=>x===null)?null:gross-costs.reduce((a,b)=>a+b,0);
 const bounded=costs=>costs.every(x=>x!==null)&&costs.reduce((a,b)=>a+b,0)>=0;
 assert.equal(profit(18000,[100,200,-1000]),18700);assert.equal(bounded([100,200,-1000]),false);
 assert.equal(profit(18000,[100,200,0]),17700);assert.equal(bounded([100,200,0]),true);
 assert.equal(profit(18000,[100,200,null]),null);assert.equal(bounded([100,200,null]),false);
 assert.equal(bounded([100,200,-300]),true); // net zero: equality, not a forced loss
 const profitText=read('ss-profit-inventory');for(const term of ['符号付き純調整','純控除額合計Cが非負','上限も未確定','FBA手数料・紹介料だけ'])assert.ok(profitText.includes(term),term);
});
test('発注候補: 期間末差引0は途中不足を解消しない。時点別に入荷を照合する',()=>{
 const balances=(arrivalDay,reserved=0)=>Array.from({length:30},(_,i)=>{const day=i+1;return -reserved+(day>=arrivalDay?45:0)-1.5*day;});
 const late=balances(30),timely=balances(1);
 assert.equal(late.at(-1),0);assert.equal(late[0],-1.5);assert.equal(late[28],-43.5);
 assert.equal(late.filter(x=>x<0).length,29);assert.ok(timely.every(x=>x>=0));
 assert.equal(Math.max(0,45-45-0),0); // rejected period-total shortcut: says zero despite 29 shortage days
 assert.equal(Math.max(0,...late.map(x=>-x)),43.5); // bridge deficit, not an authorized order quantity
 assert.equal(Math.ceil(43.5/5)*5,45); // only if timely delivery and lot=5 are confirmed
 assert.equal(0/1.5,0);assert.equal(balances(30,3)[0],-4.5); // unknown reservations cannot be silently set to zero
 const p=read('ss-profit-inventory');for(const term of ['各不足時点まで','期間内到着','1〜29日目','仮定付き参考値0÷1.5=0日'])assert.ok(p.includes(term),term);
});
