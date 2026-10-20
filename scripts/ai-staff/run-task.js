import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateTaskPacket,buildPrompt,validateOutput} from '../../lib/ai-team.js';
import {checkSubscription,codexArgs} from './cli.js';
import {resultPath} from './result-path.js';
import {parseRunArgs,delegationUnavailable,claudeBaselineArgs,buildManifest} from './delegate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
try {
  // Unknown, duplicate or invalid flags are rejected here, before any CLI/authentication call.
  const {filename,provider,delegate,model,run} = parseRunArgs(process.argv.slice(2));
  // Delegation is unapproved: always rejected before reading files/definitions, auth, CLI or model. No bypass.
  if (delegate !== null) delegationUnavailable();
  if (statSync(filename).size > 100000) throw Error('依頼は100KB以内にしてください');
  const packet = validateTaskPacket(JSON.parse(readFileSync(filename,'utf8')));
  if (!run) {
    console.log(`準備確認のみ: ${provider} / SICK STYLE / 依頼 ${packet.job_id}\n実行には --run を付けます。追加API課金の認証は使いません。`);
  } else {
    const env = checkSubscription(provider);
    const dir = mkdtempSync(resolve(tmpdir(),'sickstyle-ai-'));
    try {
      const outputFile = resolve(dir,'output.json');
      const schemaFile = resolve(root,'ai-staff/result.schema.json');
      const schema = readFileSync(schemaFile,'utf8');
      const prompt = buildPrompt(packet);
      const cliArgs = provider === 'codex' ? codexArgs({output:outputFile,schema:schemaFile}) : claudeBaselineArgs({schema,model});
      const started_at = new Date().toISOString();
      const t0 = performance.now();
      // Private temporary directory contains no credentials or project files. No retry, no resume.
      const result = spawnSync(provider,cliArgs,{cwd:dir,env,encoding:'utf8',input:prompt,killSignal:'SIGKILL',
        timeout:180000,maxBuffer:2_000_000});
      const elapsed_ms = Math.round(performance.now()-t0);
      if (result.error || result.status !== 0) throw Error('CLI分析が完了しませんでした。再試行は自動では行いません。本人端末でログイン・契約上限を確認してください');
      let output;
      if (provider === 'codex') output = validateOutput(JSON.parse(readFileSync(outputFile,'utf8')),packet.facts);
      else output = validateOutput(JSON.parse(result.stdout).structured_output,packet.facts);
      const id = randomUUID();
      const finished_at = new Date().toISOString();
      const artifact = {version:1,job_id:packet.job_id,input_hash:packet.input_hash,
        business_unit:'sickstyle',provider,execution_id:id,started_at,finished_at,output};
      const destination = resolve(root,'data','ai-results');
      mkdirSync(destination,{recursive:true,mode:0o700});
      const path = resultPath(destination,packet.job_id,id);
      if (provider === 'claude') {
        // Run metadata stays in a private sidecar so the importable envelope is unchanged.
        const manifests = resolve(destination,'manifests');
        mkdirSync(manifests,{recursive:true,mode:0o700});
        const manifest = buildManifest({mode:'baseline',packet,execution_id:id,model,
          prompt,stdout:result.stdout,output,started_at,finished_at,elapsed_ms});
        writeFileSync(resultPath(manifests,packet.job_id,id),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
      }
      writeFileSync(path,JSON.stringify(artifact,null,2)+'\n',{mode:0o600,flag:'wx'});
      console.log(`成果物を保存しました。管理画面の「成果物JSONを取り込む」で選択してください。\n${path}`);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
} catch (error) {
  // Never echo model output, transcripts or task contents on validation failures.
  console.error(error.name === 'TeamError' ? error.message :
    error instanceof SyntaxError ? 'JSON形式を確認してください' :
    error.code ? 'ファイル・CLIの状態を確認してください' : error.message);
  process.exitCode = 1;
}
