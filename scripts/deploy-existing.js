// Existing Worker only. No provisioning, migrations, secret writes or plan changes.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ensureFree} from './lib/free-check.js';
import {requireWranglerLogin} from './lib/wrangler-auth.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const env = {...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};
const run = (bin,args,options={}) => spawnSync(bin,args,{cwd:root,env,encoding:'utf8',...options});
const wrangler = (args,options) => run(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],options);
function versionConfig(config) {
  // Never overwrite dashboard variables with the local wrangler vars block.
  const copy = structuredClone(config);
  for (const key of ['vars','triggers','routes','workers_dev','preview_urls','$schema']) delete copy[key];
  copy.main = resolve(root,copy.main);
  copy.assets.directory = resolve(root,copy.assets.directory);
  copy.d1_databases.forEach(db => db.migrations_dir=resolve(root,db.migrations_dir));
  mkdirSync('.wrangler',{recursive:true});
  const path = resolve(root,'.wrangler',`code-only-${randomUUID()}.json`);
  writeFileSync(path,JSON.stringify(copy),{mode:0o600,flag:'wx'});
  return path;
}
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || !['--apply','--dry-run'].includes(args[0]))) throw Error('引数は省略（確認のみ）、または --dry-run / --apply のみを指定してください');
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  if (config.name !== 'sickstyle-manager' || !config.account_id ||
      config.d1_databases?.[0]?.database_id !== '009fbd34-6b04-4a82-8e33-cfc44c2416ec')
    throw Error('既存SICK STYLE WorkerとD1の設定を確認してください');
  if (args[0] === '--dry-run') {
    const path = versionConfig(config);
    try {
      if(wrangler(['versions','upload','--config',path,'--keep-vars','--dry-run'],{stdio:'inherit'}).status !== 0)
        throw Error('コード専用Versionのdry-runが失敗しました');
    } finally { rmSync(path,{force:true}); }
  } else if (!args.includes('--apply')) {
    console.log('確認のみ。対象: '+config.name+'\n手順: 本人認証 → Free確認 → npm test → 既存設定を保持してVersionアップロード → 100%反映 → 読み取り検証\nSecrets・Variables・DBマイグレーション・Cron・ルート・プランの変更は行いません。実行: npm run deploy:existing -- --apply');
  } else {
    const who = wrangler(['whoami','--json']);
    requireWranglerLogin(who);
    await ensureFree(config.account_id);
    const git = args => {
      const r = run('git',args);
      if (r.status !== 0) throw Error('Git状態を確認してください');
      return r.stdout.trim();
    };
    if (git(['status','--porcelain'])) throw Error('変更をコミットしてから反映してください');
    const head = git(['rev-parse','HEAD']);
    if (run('npm',['test'],{stdio:'inherit'}).status !== 0) throw Error('テスト失敗のため停止しました');
    if (git(['rev-parse','HEAD']) !== head || git(['status','--porcelain'])) throw Error('テスト中にコードが変更されました');
    const path = versionConfig(config);
    try {
      const tag = 'sickstyle-'+head.slice(0,12)+'-'+randomUUID().slice(0,8);
      console.log('反映対象SHA: '+head+' / Version tag: '+tag);
      // Native version operations preserve schedules and routes. Upload never changes live traffic.
      if (wrangler(['versions','upload','--config',path,'--keep-vars','--strict','--tag',tag,
          '--message','SICK STYLE AI team '+head.slice(0,12)],{stdio:'inherit'}).status !== 0)
        throw Error('Versionアップロード未完了。本番トラフィックは切り替えていません');
      if (wrangler(['versions','deploy','--config',path,'--version-tag',tag+'@100',
          '--yes','--message','SICK STYLE '+head.slice(0,12)],{stdio:'inherit'}).status !== 0)
        throw Error('本番切り替え未確認。CloudflareのDeploymentsで状態を確認してください');
      if (run(process.execPath,['scripts/verify-existing.js'],{stdio:'inherit'}).status !== 0)
        throw Error('反映後の読み取り検証が失敗しました。Deploymentsから直前VersionへのRollbackを検討してください');
      console.log('コードの本番反映と公開・未認証応答を確認しました。本人ログイン後のAI社員操作は管理画面で確認してください。');
    } finally { rmSync(path,{force:true}); }
  }
} catch (error) { console.error(error.code ? 'ローカル設定・CLIの状態を確認してください' : error.message); process.exitCode=1; }
