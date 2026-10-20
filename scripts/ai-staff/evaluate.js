// Offline Phase T evaluator. It never calls a model: it writes task packets for the synthetic fixtures and
// scores supplied artifacts. Production improvement is approved; runtime evaluation remains staged behind review.
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createJob,taskPacket,TeamError} from '../../lib/ai-team.js';
import {FIXTURES,findFixture,fixtureInput,fixtureInputHash,scoreOutput} from './eval-fixtures.js';

export const EVALUATION_STATUS='限定3段階は承認・配置済み、初回比較不成立。通常委譲と追加評価は停止中。表示する実行コマンドは追加承認後の計画です。';
const USAGE='使い方: node scripts/ai-staff/evaluate.js packets 新しい出力先 | score FIXTURE_ID ARTIFACT.json';
export function writePackets(out,now=new Date().toISOString()){
  const dir=resolve(out);
  mkdirSync(dir,{mode:0o700}); // Fails if it already exists, so nothing is overwritten.
  const index=FIXTURES.map(f=>{
    const packet=taskPacket(createJob(fixtureInput(f),now));
    const file=resolve(dir,f.id+'.task.json');
    writeFileSync(file,JSON.stringify(packet,null,2)+'\n',{mode:0o600,flag:'wx'});
    return {fixture:f.id,category:f.category,role:f.role,delegate:f.delegate,job_id:packet.job_id,input_hash:packet.input_hash,
      baseline:`npm run ai:task -- ${file} --provider claude --model MODEL --run`,
      delegated:`npm run ai:task -- ${file} --provider claude --delegate ${f.delegate} --model MODEL --run`};
  });
  writeFileSync(resolve(dir,'index.json'),JSON.stringify({synthetic:true,note:EVALUATION_STATUS,index},null,2)+'\n',{mode:0o600,flag:'wx'});
  return index;
}
export function scoreArtifact(fixtureId,file){
  const fixture=findFixture(fixtureId);
  if(!fixture)throw new TeamError('評価ケースIDを確認してください');
  if(statSync(file).size>150000)throw new TeamError('成果物は150KB以内にしてください');
  const artifact=JSON.parse(readFileSync(file,'utf8'));
  if(artifact?.business_unit!=='sickstyle'||artifact.input_hash!==fixtureInputHash(fixture))
    throw new TeamError('成果物が指定した評価ケースの入力と一致しません');
  return {...scoreOutput(fixture,artifact.output),provider:artifact.provider,execution_id:artifact.execution_id,
    note:'自動採点は語句・数値・根拠IDの機械的確認です。意味の正しさは人間のブラインドレビューで判断します。'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [command,...rest]=process.argv.slice(2);
    if(command==='packets'&&rest.length===1){
      const index=writePackets(rest[0]);
      console.log(`架空評価用の依頼を${index.length}件作成しました（モデル呼び出しはしていません）。\n${EVALUATION_STATUS}\n${index[0].baseline}\n${index[0].delegated}`);
    }else if(command==='score'&&rest.length===2)console.log(JSON.stringify(scoreArtifact(rest[0],rest[1]),null,2));
    else throw new TeamError(USAGE);
  }catch(error){
    console.error(error.name==='TeamError'?error.message:error instanceof SyntaxError?'JSON形式を確認してください':'ファイルの状態を確認してください');
    process.exitCode=1;
  }
}
