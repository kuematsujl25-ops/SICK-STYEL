import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateTaskPacket,buildPrompt,validateOutput} from '../../lib/ai-team.js';
import {checkSubscription,codexArgs} from './cli.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag)+1];
try {
  const filename = args[0];
  let providerSeen=false,runSeen=false;
  for(let i=1;i<args.length;i++){
    if(args[i]==='--provider'&&!providerSeen&&args[i+1]){providerSeen=true;i++;}
    else if(args[i]==='--run'&&!runSeen){runSeen=true;}
    else throw Error('対応する引数は TASK.json --provider codex|claude [--run] です');
  }
  const provider = args.includes('--provider') ? value('--provider') : 'codex';
  if (!filename || !['codex','claude'].includes(provider))
    throw Error('使い方: node scripts/ai-staff/run-task.js TASK.json --provider codex|claude [--run]');
  if (statSync(filename).size > 100000) throw Error('依頼は100KB以内にしてください');
  const packet = validateTaskPacket(JSON.parse(readFileSync(filename,'utf8')));
  if (!args.includes('--run')) {
    console.log(`準備確認のみ: ${provider} / SICK STYLE / 依頼 ${packet.job_id}\n実行には --run を付けます。追加API課金の認証は使いません。`);
  } else {
    const env = checkSubscription(provider);
    const dir = mkdtempSync(resolve(tmpdir(),'sickstyle-ai-'));
    try {
      const outputFile = resolve(dir,'output.json');
      const schemaFile = resolve(root,'ai-staff/result.schema.json');
      const schema = readFileSync(schemaFile,'utf8');
      const cliArgs = provider === 'codex' ? codexArgs({output:outputFile,schema:schemaFile}) :
        ['-p','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
          '--no-session-persistence','--output-format','json','--json-schema',schema,
          '--settings','{"disableAllHooks":true}'];
      const started_at = new Date().toISOString();
      // Private temporary directory contains no credentials or project files.
      const result = spawnSync(provider,cliArgs,{cwd:dir,env,encoding:'utf8',
        input:buildPrompt(packet),timeout:180000,maxBuffer:2_000_000});
      if (result.status !== 0) throw Error('CLI分析が完了しませんでした。再試行は自動では行いません。本人端末でログイン・契約上限を確認してください');
      const raw = provider === 'codex' ? JSON.parse(readFileSync(outputFile,'utf8')) :
        JSON.parse(result.stdout).structured_output;
      const output = validateOutput(raw,packet.facts);
      const id = randomUUID();
      const artifact = {version:1,job_id:packet.job_id,input_hash:packet.input_hash,
        business_unit:'sickstyle',provider,execution_id:id,started_at,
        finished_at:new Date().toISOString(),output};
      const destination = resolve(root,'data','ai-results');
      mkdirSync(destination,{recursive:true,mode:0o700});
      const path = resolve(destination,`${packet.job_id}-${id}.json`);
      writeFileSync(path,JSON.stringify(artifact,null,2)+'\n',{mode:0o600,flag:'wx'});
      console.log(`成果物を保存しました。管理画面の「成果物JSONを取り込む」で選択してください。\n${path}`);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
} catch (error) {
  // Never echo model output or task contents on validation failures.
  console.error(error.name === 'TeamError' ? error.message :
    error instanceof SyntaxError ? 'JSON形式を確認してください' :
    error.code ? 'ファイル・CLIの状態を確認してください' : error.message);
  process.exitCode = 1;
}
