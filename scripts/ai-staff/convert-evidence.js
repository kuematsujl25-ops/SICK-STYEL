// Offline only: Git source verification and local evidence replay. Never invokes an auth/model CLI.
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readEvidence,saveEvidence,prepareEvidenceRoot,createEvidenceDirectory} from './run-evidence.js';
import {replayRunEvidence,reauditRejectedEvidence,hash} from './delegate-runtime.js';
import {validateTaskPacket,validateOutput,isTaskId,TeamError} from '../../lib/ai-team.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const fail=()=>{throw new TeamError('オフライン変換の証拠・監査・期限・排他記録を確認できません。再実行せず保存状態を確認してください');};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const hash64=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
// Verify all tracked runtime dependencies against the requested commit, including this converter.
export function verifyAuditImplementation(repository,expected){
 if(!sha(expected))fail();
 const git=args=>execFileSync('git',['-C',repository,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(git(['rev-parse','HEAD']).trim()!==expected)fail();
 const paths=git(['ls-tree','-r','--name-only',expected,'scripts/ai-staff','lib','public/ai-catalog.js']).trim().split('\n');
 if(!paths.includes('scripts/ai-staff/convert-evidence.js'))fail();
 for(const p of paths){const stat=lstatSync(join(repository,p));if(!stat.isFile()||stat.isSymbolicLink())fail();
  const committed=execFileSync('git',['-C',repository,'show',expected+':'+p],{stdio:['ignore','pipe','pipe']});
  if(!readFileSync(join(repository,p)).equals(committed))fail();}
}
function replay(sourceDir,sourceHash,retrospective){return retrospective?reauditRejectedEvidence(sourceDir,sourceHash):replayRunEvidence(sourceDir,sourceHash);}
export function auditRecord(source,sourceHash,replayed,implementationSha,retrospective){
 const m=source.manifest.metadata,packet=validateTaskPacket(JSON.parse(source.files['packet.json']));
 if(!hash64(sourceHash)||!sha(implementationSha)||!['accepted','rejected'].includes(m.audit_status)||retrospective!==(m.audit_status==='rejected')||replayed.quality_approved!==false)fail();
 if(retrospective&&(replayed.retrospective!==true||replayed.original_manifest_sha256!==sourceHash))fail();
 validateOutput(replayed.checked.output,packet.facts);
 return {version:1,kind:'offline-artifact-audit',source_manifest_sha256:sourceHash,implementation_sha:implementationSha,original_audit_status:m.audit_status,retrospective,packet,packet_sha256:hash(packet),audit:replayed,quality_approved:false};
}
export function prepareArtifact(source,sourceHash,receipt,replayed,implementationSha,now=Date.now()){
 const expected=auditRecord(source,sourceHash,replayed,implementationSha,source.manifest.metadata.audit_status==='rejected');
 if(!isDeepStrictEqual(receipt,expected))fail();
 const m=source.manifest.metadata,start=Date.parse(m.started_at),end=Date.parse(m.finished_at);
 if(!Number.isFinite(now)||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end>now+300000||now-end>7*86400000||!isTaskId(m.session))fail();
 return {version:1,job_id:receipt.packet.job_id,input_hash:receipt.packet.input_hash,business_unit:'sickstyle',provider:'claude',execution_id:m.session,started_at:m.started_at,finished_at:m.finished_at,output:structuredClone(replayed.checked.output)};
}
function privateDirectory(path){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||(process.getuid&&s.uid!==process.getuid()))fail();}
// Deterministic execution ID + a shared, atomic per-session directory: duplicates and partial writes fail closed.
export function writeConversion(registry,artifact,sidecar){
 privateDirectory(registry);if(!isTaskId(artifact.execution_id))fail();
 const dir=join(registry,artifact.execution_id);mkdirSync(dir,{mode:0o700});
 const saved=saveEvidence(dir,{'artifact.json':JSON.stringify(artifact,null,2)+'\n','conversion.json':JSON.stringify(sidecar,null,2)+'\n'},{kind:'offline-artifact-conversion',quality_approved:false});
 readEvidence(dir,saved.manifest_sha256);return saved;
}
export function auditEvidence({sourceDir,sourceHash,implementationSha,retrospective=false}){
 verifyAuditImplementation(root,implementationSha);
 const source=readEvidence(sourceDir,sourceHash),checked=replay(sourceDir,sourceHash,retrospective);
 const record=auditRecord(source,sourceHash,checked,implementationSha,retrospective);
 const dir=createEvidenceDirectory(prepareEvidenceRoot());return saveEvidence(dir,{'audit.json':JSON.stringify(record,null,2)},{kind:record.kind,quality_approved:false});
}
export function convertEvidence({sourceDir,sourceHash,auditDir,auditHash,implementationSha}){
 verifyAuditImplementation(root,implementationSha);
 const source=readEvidence(sourceDir,sourceHash),savedAudit=readEvidence(auditDir,auditHash);
 if(savedAudit.manifest.metadata.kind!=='offline-artifact-audit')fail();
 const receipt=JSON.parse(savedAudit.files['audit.json']);
 const checked=replay(sourceDir,sourceHash,receipt.retrospective);
 const artifact=prepareArtifact(source,sourceHash,receipt,checked,implementationSha);
 // Re-read originals before reserving the immutable conversion slot.
 readEvidence(sourceDir,sourceHash);readEvidence(auditDir,auditHash);
 const registry=join(prepareEvidenceRoot(),'conversions');if(!existsSync(registry))mkdirSync(registry,{mode:0o700});
 const sidecar={version:1,source_manifest_sha256:sourceHash,audit_manifest_sha256:auditHash,original_audit_status:receipt.original_audit_status,retrospective:receipt.retrospective,audit_implementation_sha:implementationSha,conversion_sha:implementationSha,packet_sha256:receipt.packet_sha256,artifact_sha256:hash(artifact),quality_approved:false,server_authenticity_verified:false,converted_at:new Date().toISOString()};
 return writeConversion(registry,artifact,sidecar);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [mode,...args]=process.argv.slice(2);let result;
  if(mode==='audit'&&(args.length===3||args.length===4&&args[3]==='--retrospective'))result=auditEvidence({sourceDir:args[0],sourceHash:args[1],implementationSha:args[2],retrospective:args.length===4});
  else if(mode==='convert'&&args.length===5)result=convertEvidence({sourceDir:args[0],sourceHash:args[1],auditDir:args[2],auditHash:args[3],implementationSha:args[4]});else fail();
  console.log(JSON.stringify(result));
 }catch{console.error('オフライン監査・変換は未完了です。元証拠と排他保存状態を確認してください。モデルは起動していません。');process.exitCode=1;}
}
