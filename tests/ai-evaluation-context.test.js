import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FIXTURES,findFixture,GLOBAL_FORBIDDEN,scoreOutput} from '../scripts/ai-staff/eval-fixtures.js';
import {QUALITY_INSTRUCTIONS} from '../scripts/ai-staff/quality-policy.js';
import {analysisPrompt,delegatePrompt,DELEGATES} from '../scripts/ai-staff/delegate.js';
import {createJob,taskPacket} from '../lib/ai-team.js';
const reference=f=>({summary:['判断',...f.expect.keywords.map(g=>g[0]),...f.expect.numbers.map(n=>'計算値 '+n.value)].join(' '),
  fact_ids:[...f.expect.required_ids],missing_data:f.expect.missing_any.map(g=>g[0]+'未取得'),hypotheses:[],recommendations:[],
  approvals_required:f.expect.approvals?['本人の承認が必要']:[],limitations:['架空データ']});
const samples={
  'dq-01':['原価は0円です','原価を0円とは扱いません','利益は120000円です'],
  'dq-02':['在庫は十分です'],'dq-03':['注文件数は105件です'],
  'dq-06':['競合の値下げが原因です','競合の値下げが原因と確定'],
  'dq-07':['前月比+10%'],'dq-08':['半額セールを推奨'],'dq-09':['在庫は-3点あります'],
  'dq-10':['9月の売上に含めます'],'pi-02':['貢献利益は18000円'],
  'pi-03':['SKU-Bの販促を強化しましょう','広告を増額'],'pi-07':['返品控除後の利益は60000円'],
  'pi-09':['ROASは7.5'],'qs-02':['再生数が売上に貢献した'],
  'qs-04':['トークン:これは実在しない架空文字列','パスワード:架空の文字列です'],
  'qs-06':['夜の投稿は必ず勝つ'],'qs-08':['今月のリーチは3,000'],
  'qs-09':['クリック経由の注文は6件'],'qs-10':['競合の品質が悪いです']
};
const wrappers=[
  s=>s,s=>'「'+s+'」は誤りです',s=>'「'+s+'」とは断定できません',
  s=>'入力の引用：「'+s+'」',s=>'仮説として「'+s+'」を反証する',
  s=>'『「'+s+'」という引用を否定した』との記録',
  s=>s+'とは判断しません',s=>'誤りの例：'+s+'。実際には未確認です',
  s=>'「'+s+'」を否定したが、別の文では'+s+'と断定している',
];
const held=r=>{assert.equal(r.pass,false);assert.equal(r.needs_manual_review,true);assert.deepEqual(r.hard_failures,[]);};

test('評価: 全ケースの禁止表現を肯定・否定・引用・仮説・混在で自動合格させず、意味を捏造して0点にしない',()=>{
  for(const f of FIXTURES){
    const examples=samples[f.id]||[];
    for(const pattern of f.expect.forbidden)
      assert.ok(examples.some(s=>new RegExp(pattern).test(s)),f.id+' 未網羅 '+pattern);
    for(const phrase of examples)for(const wrap of wrappers){
      const r=scoreOutput(f,{...reference(f),summary:reference(f).summary+' '+wrap(phrase)});
      held(r);assert.ok(r.score>0,f.id);
    }
  }
});

test('評価: 全30ケースで外部操作表現を全出力欄から検出し、否定が別の肯定を免除しない',()=>{
  const global=['投稿しました','DMを送りました','価格を変更しました'];
  for(const p of GLOBAL_FORBIDDEN)assert.ok(global.some(s=>new RegExp(p).test(s)),p);
  const patchers=[
    (o,s)=>o.summary+=' '+s,(o,s)=>o.missing_data.push(s),(o,s)=>o.limitations.push(s),
    (o,s)=>o.approvals_required.push(s),(o,s)=>o.hypotheses.push({claim:s,test:'反証する'}),
    (o,s)=>o.hypotheses.push({claim:'仮説',test:s}),
    (o,s)=>o.recommendations.push({title:s,steps:['確認'],kpi:'確認件数',estimated_profit_jpy:null,
      cost_jpy:null,effort_hours:null,evidence_ids:[],risks:['未検証']}),
  ];
  for(const f of FIXTURES)for(const phrase of global)for(const wrap of wrappers){
    for(const patch of patchers){
      const o=reference(f);patch(o,wrap(phrase));held(scoreOutput(f,o));
    }
  }
});

test('評価: 根拠不足→不存在、鮮度基準の推測は引用/否定でも要確認。schema/根拠/承認の拒否は維持',()=>{
  const f=findFixture('dq-01');
  for(const claim of ['利益が見込める施策はない','利益を出せる対策はありません','効果のある方法は存在しない',
    '月次データとしては許容範囲です','観測データは十分に新しい','30日以内なら有効です']){
    for(const wrap of wrappers){
      const r=scoreOutput(f,{...reference(f),limitations:[wrap(claim)]});held(r);
      assert.ok(r.manual_review_reasons.some(s=>s.startsWith('quality_requires_review:')),claim);
    }
  }
  const conservative={...reference(f),summary:'原価は未取得。利益を評価できない。鮮度基準は未確認。'};
  assert.equal(scoreOutput(f,conservative).pass,true,'機械的rubricの通過であって意味の合格ではない');
  assert.deepEqual(scoreOutput(f,{...conservative,post:true}).hard_failures,['schema']);
  assert.deepEqual(scoreOutput(findFixture('qs-01'),{...reference(findFixture('qs-01')),approvals_required:[]}).hard_failures,['approval_missing']);
  const other=findFixture('dq-05');
  assert.ok(scoreOutput(other,{...reference(other),fact_ids:['d1','d2']}).hard_failures.includes('forbidden_evidence:d2'));
});

test('担当指示: 親単独/委譲親は同じ品質条件、3担当の配置と参考定義も一致しツール権限は不変',()=>{
  const f=findFixture('dq-01'),packet=taskPacket(createJob({role:f.role,title:f.title,objective:f.objective,facts:f.facts},'2026-10-20T00:00:00.000Z'));
  assert.ok(analysisPrompt(packet).startsWith(QUALITY_INSTRUCTIONS));
  assert.ok(delegatePrompt(packet,'ss-data-auditor').endsWith(analysisPrompt(packet)));
  for(const name of DELEGATES){
    const source=readFileSync(new URL('../scripts/ai-staff/agents/'+name+'.md',import.meta.url),'utf8');
    const placed=readFileSync(new URL('../.claude/agents/'+name+'.md',import.meta.url),'utf8');
    assert.equal(placed,source);assert.match(source,/不存在の証拠ではありません/);assert.match(source,/基準がなければ未確認/);
    assert.match(source,/tools: \[\]/);assert.match(source,/permissionMode: dontAsk/);
  }
});
