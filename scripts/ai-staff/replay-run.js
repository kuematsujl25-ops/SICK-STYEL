// Read-only local replay. Never print task text, raw logs, model output, auth or settings values.
import {replayRunEvidence} from './delegate-runtime.js';
try{
  const args=process.argv.slice(2);
  if(args.length!==2)throw Error();
  const result=replayRunEvidence(args[0],args[1]);
  console.log(JSON.stringify({evidence_verified:true,profile:result.checked.audit.profile,
    counts:result.checked.counts,guard_evidence:result.guardEvidence,quality_approved:false}));
}catch{
  console.error('私有証拠を再検証できません。成果物は取り込みません。');process.exitCode=1;
}
