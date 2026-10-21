import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {auditRecord,prepareArtifact,writeConversion,verifyAuditImplementation} from '../scripts/ai-staff/convert-evidence.js';
import {hash} from '../scripts/ai-staff/delegate-runtime.js';
import {readEvidence} from '../scripts/ai-staff/run-evidence.js';
import {FIXTURES,fixtureInput,fixtureInputHash} from '../scripts/ai-staff/eval-fixtures.js';
import {createJob,taskPacket,transitionTeam,emptyTeam} from '../lib/ai-team.js';
import {analysisPrompt,delegatePrompt,agentDefinition} from '../scripts/ai-staff/delegate.js';
import {JSON_OUTPUT_INSTRUCTION} from '../scripts/ai-staff/quality-policy.js';
import {renderTeam,renderKnowledge} from '../public/ai-team.js';
const now=Date.now(),stamp=new Date(now).toISOString(),sha='a'.repeat(40),anchor='b'.repeat(64);
function fixture(rejected=false){
 const job=createJob(fixtureInput(FIXTURES[0]),stamp),packet=taskPacket(job);
 const output={summary:'架空データ。原価が未取得。',fact_ids:['d1'],missing_data:['原価'],hypotheses:[],recommendations:[],approvals_required:['本人確認'],limitations:['試験のみ']};
 const source={manifest:{metadata:{audit_status:rejected?'rejected':'accepted',session:randomUUID(),started_at:stamp,finished_at:stamp}},files:{'packet.json':Buffer.from(JSON.stringify(packet))}};
 const replayed={checked:{output},guardEvidence:{startup:true},quality_approved:false,...(rejected?{retrospective:true,original_manifest_sha256:anchor}:{})};
 return {job,packet,source,replayed,receipt:auditRecord(source,anchor,replayed,sha,rejected)};
}
test('オフライン変換: 元packet/日時/session ID/出力保持、取込後はin_reviewで未採用',()=>{
 const f=fixture(),artifact=prepareArtifact(f.source,anchor,f.receipt,f.replayed,sha,now);
 assert.equal(artifact.job_id,f.packet.job_id);assert.equal(artifact.input_hash,f.packet.input_hash);assert.equal(artifact.execution_id,f.source.manifest.metadata.session);assert.equal(artifact.started_at,stamp);assert.deepEqual(artifact.output,f.replayed.checked.output);
 const state={...emptyTeam(),enabled:true,jobs:[f.job]};const imported=transitionTeam(state,{action:'import',job_id:f.job.id,packet:artifact},stamp);
 assert.equal(imported.jobs[0].status,'in_review');assert.equal(imported.knowledge.length,0);
});
test('別packet/出力/監査結果/SHA/元hash/qualityの改変は拒否',()=>{
 const f=fixture();for(const mutate of [r=>r.packet.objective+='x',r=>r.packet_sha256='0'.repeat(64),r=>r.audit.checked.output.summary+='x',r=>r.audit.guardEvidence.startup=false,r=>r.implementation_sha='c'.repeat(40),r=>r.source_manifest_sha256='d'.repeat(64),r=>r.quality_approved=true]){
  const bad=structuredClone(f.receipt);mutate(bad);assert.throws(()=>prepareArtifact(f.source,anchor,bad,f.replayed,sha,now));
 }
 const packet={...f.packet,objective:'改変'};const changed={...f.source,files:{'packet.json':Buffer.from(JSON.stringify(packet))}};assert.throws(()=>prepareArtifact(changed,anchor,f.receipt,f.replayed,sha,now));
});
test('拒否記録は明示的事後監査だけ、7日超/未来/逆転/不正session拒否',()=>{
 const f=fixture(true);assert.equal(prepareArtifact(f.source,anchor,f.receipt,f.replayed,sha,now).job_id,f.packet.job_id);
 assert.throws(()=>auditRecord(f.source,anchor,f.replayed,sha,false));
 for(const patch of [{finished_at:new Date(now-7*86400000-1).toISOString(),started_at:new Date(now-8*86400000).toISOString()},{finished_at:new Date(now+300001).toISOString()},{started_at:new Date(now+1).toISOString()},{session:'bad'}]){
  const src={...f.source,manifest:{metadata:{...f.source.manifest.metadata,...patch}}};assert.throws(()=>prepareArtifact(src,anchor,f.receipt,f.replayed,sha,now));
 }
});
test('排他保存: 再変換/途中保存拒否、artifact/sidecar改変はhash検証拒否',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ss-convert-'));try{
  const f=fixture(),artifact=prepareArtifact(f.source,anchor,f.receipt,f.replayed,sha,now),sidecar={artifact_sha256:hash(artifact),quality_approved:false};
  const saved=writeConversion(dir,artifact,sidecar);assert.deepEqual(JSON.parse(readEvidence(saved.directory,saved.manifest_sha256).files['artifact.json']),artifact);
  assert.throws(()=>writeConversion(dir,artifact,sidecar));
  writeFileSync(join(saved.directory,'artifact.json'),'changed');assert.throws(()=>readEvidence(saved.directory,saved.manifest_sha256));
  const partial={...artifact,execution_id:randomUUID()};mkdirSync(join(dir,partial.execution_id),{mode:0o700});assert.throws(()=>writeConversion(dir,partial,sidecar));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('監査実装SHA不明/別HEADはファイル生成前に拒否',()=>{
 assert.throws(()=>verifyAuditImplementation(process.cwd(),'unknown'));assert.throws(()=>verifyAuditImplementation(process.cwd(),'0'.repeat(40)));
});
test('30標準packet不変、固定指示は共通親promptと担当定義に置く',()=>{
 for(const f of FIXTURES){const packet=taskPacket(createJob(fixtureInput(f),stamp)),before=JSON.stringify(packet);const parent=analysisPrompt(packet),delegated=delegatePrompt(packet,f.delegate);
  assert.equal(packet.input_hash,fixtureInputHash(f));assert.equal(JSON.stringify(packet),before);assert.equal(packet.objective,f.objective);assert.ok(parent.includes(JSON_OUTPUT_INSTRUCTION));assert.ok(delegated.endsWith(parent));
  const definition=agentDefinition(f.delegate,readFileSync(new URL('../scripts/ai-staff/agents/'+f.delegate+'.md',import.meta.url),'utf8'));assert.match(definition.prompt,/JSONオブジェクト本体のみ/);assert.match(definition.prompt,/Markdownコード枠は禁止/);
 }
});
test('取込と履歴でサーバー未検証・登録provider/実行IDを明示',()=>{
 const f=fixture(),state={...emptyTeam(),enabled:true,jobs:[f.job],knowledge:[{job_id:f.job.id,recorded_at:stamp,execution:{provider:'claude',id:'fixture'},decision:{action:'reject',note:'ISOLATED TEST SIMULATION'},output:f.replayed.checked.output}]};
 assert.match(renderTeam({state,catalog:[]},String),/本人登録JSON。生成元・内容の真正性はサーバー未検証/);
 const html=renderKnowledge(state,String);assert.match(html,/登録provider claude/);assert.match(html,/登録実行ID fixture/);assert.match(html,/サーバー未検証/);
});
