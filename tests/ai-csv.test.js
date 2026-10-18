import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTeamCSV} from '../public/ai-csv.js';
import {validateFacts} from '../lib/ai-team.js';
const now=new Date('2026-10-18T01:00:00Z');
const header='service,date_jst,metric,value,unit,source,observed_at\n';
const row='base,2026-10-17,sales,1200,JPY,official_dashboard_manual,2026-10-18T00:00:00Z';
test('CSVのサービス・期間・取得元を保持し、空欄と実測0を区別',()=>{
  const facts=parseTeamCSV('\uFEFF'+header+row+'\r\n'+
    'tiktok,2026-10-17,views,,count,official_dashboard_manual,2026-10-18T00:00:00Z\r\n'+
    'tiktok,2026-10-17,followers,0,count,official_dashboard_manual,2026-10-18T00:00:00Z\r\n',now);
  assert.equal(facts[0].value,1200);assert.match(facts[0].label,/base.*2026-10-17/);
  assert.equal(facts[1].value,null);assert.equal(facts[2].value,0);
  assert.equal(validateFacts(facts).length,3);
});
test('Metricoolはチャネルを保持し引用符付き取得元を解析',()=>{
  const text='service,date_jst,channel,metric,value,unit,source,observed_at\n'+
    'metricool,2026-10-17,Instagram,reach,50,count,"official, dashboard",2026-10-18T00:00:00Z';
  const facts=parseTeamCSV(text,now);assert.match(facts[0].label,/metricool.*Instagram/);
  assert.equal(facts[0].source,'official, dashboard');
});
test('CSVは重複・数式・不正日付・負値・小数の件数・サービス混同を拒否',()=>{
  assert.throws(()=>parseTeamCSV(header+row+'\n'+row,now),/重複/);
  for(const replacement of [row.replace(',1200,','=1+1,'),row.replace(',1200,',',-1,'),
    row.replace('2026-10-17','2026-02-30'),row.replace('2026-10-17','2026-10-19'),
    row.replace('base,','amazon,'),row.replace('sales,1200,JPY','orders,1.5,count'),
    row.replace('T00:00:00Z','T00:00:00'),row.replace('official_dashboard_manual',''),
    row.replace('T00:00:00Z','T20:00:00Z')])
    assert.throws(()=>parseTeamCSV(header+replacement,now));
  assert.throws(()=>parseTeamCSV(header+Array(31).fill(row).join('\n'),now),/30/);
});
test('CSVの不明な列・壊れた引用符・個人情報は拒否',()=>{
  assert.throws(()=>parseTeamCSV(header.replace('source','email')+row,now));
  assert.throws(()=>parseTeamCSV(header+row.replace('official_dashboard_manual','"not closed'),now));
  assert.throws(()=>validateFacts(parseTeamCSV(header+row.replace('official_dashboard_manual','owner@example.com'),now)),/個人情報/);
});
