// Existing Worker only. No provisioning, migrations, secret writes or plan changes.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ensureFree} from './lib/free-check.js';
import {requireWranglerLogin} from './lib/wrangler-auth.js';
import {reviewForHead,productionVersions,verifySqlBackup,checkReadiness} from './lib/release-readiness.js';
import {ask} from './lib/prompt.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const env = {...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'};
const run = (bin,args,options={}) => spawnSync(bin,args,{cwd:root,env,encoding:'utf8',...options});
const wrangler = (args,options) => run(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],options);
const git = args => {
  const r=run('git',args);if(r.status!==0)throw Error('Git状態を確認してください');return r.stdout.trim();
};
const currentVersions=()=>{
  const r=wrangler(['deployments','status','--name','sickstyle-manager','--json']);
  if(r.status!==0)throw Error('本番Versionを取得できません。反映を停止します');
  try{return productionVersions(JSON.parse(r.stdout));}catch{throw Error('本番Versionの応答を確認できません');}
};
async function confirmed(question) {
  if(!process.stdin.isTTY||!/^(y|yes|はい)$/i.test(await ask(question+' [y/N]: ')))
    throw Error('本番反映の実行条件を確認できないため停止しました');
}
const rollbackArgs=versions=>['versions','deploy',...versions.map(v=>v.version_id+'@'+v.percentage),'--yes'];
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
  if (args.length && (args.length !== 1 || !['--apply','--dry-run','--preflight'].includes(args[0]))) throw Error('引数は省略（確認のみ）、または --dry-run / --preflight / --apply のみを指定してください');
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  if (config.name !== 'sickstyle-manager' || config.account_id!=='0e7f3c8d35e879a843cda721fc0435f0' ||
      config.d1_databases?.[0]?.database_id !== '009fbd34-6b04-4a82-8e33-cfc44c2416ec')
    throw Error('既存SICK STYLE WorkerとD1の設定を確認してください');
  env.CLOUDFLARE_ACCOUNT_ID=config.account_id;
  if (args[0] === '--dry-run') {
    const path = versionConfig(config);
    try {
      if(wrangler(['versions','upload','--config',path,'--keep-vars','--dry-run'],{stdio:'inherit'}).status !== 0)
        throw Error('コード専用Versionのdry-runが失敗しました');
    } finally { rmSync(path,{force:true}); }
  } else if (!args.length) {
    console.log('確認のみ。対象: '+config.name+'\n手順: 最新SHAの独立レビュー → 本人認証 → Free/追加費用0円確認 → 本番Version記録 → D1バックアップ/ローカル復元確認 → npm test/build → コード専用dry-run → Version反映 → 読み取り検証\nSecrets・Variables・DBマイグレーション・Cron・ルート・プランの変更は行いません。npm run deploy:preflight の成功が --apply の前提です。');
  } else {
    const who = wrangler(['whoami','--json']);
    const account=requireWranglerLogin(who);
    if(!account.accounts?.some(a=>a.id===config.account_id))throw Error('本人アカウントの対象Cloudflareアカウントへのアクセスを確認できません');
    await ensureFree(config.account_id);
    if (git(['status','--porcelain'])) throw Error('変更をコミットしてから反映してください');
    const head = git(['rev-parse','HEAD']);
    const reviewBase=git(['rev-parse','origin/claude/initial-github-sync']);
    const remoteHead=git(['ls-remote','--heads','origin','ai-staff/phase4-runtime']).split(/\s/)[0];
    const remoteBase=git(['ls-remote','--heads','origin','claude/initial-github-sync']).split(/\s/)[0];
    if(remoteHead!==head||remoteBase!==reviewBase)throw Error('PRまたは比較元が更新されています。fetch/pull後に最新SHAを再レビューしてください');
    const receiptPath=resolve(root,'data/deploy-readiness',head+'.json');
    if(args[0]==='--preflight') {
      process.umask(0o077);
      const review=reviewForHead(root,head,reviewBase);
      console.log('最新SHA: '+head+'\n独立レビュー: '+resolve(root,review.file));
      await confirmed('上記レビュー本文を読み、未解決のP0/P1/P2がないことを確認しましたか？');
      await confirmed('上記SHAのGitHub CI成功、Secrets検査、PC/iPhone相当表示を確認しましたか？');
      await confirmed('本人のCloudflare画面でWorkers・D1がFree、追加契約・従量課金が発生しないことを確認しましたか？');
      const previous=currentVersions();
      const directory=resolve(root,'data/deployment-backups',head+'-'+randomUUID());
      mkdirSync(directory,{recursive:true,mode:0o700});
      const backupFile=resolve(directory,'d1.sql');
      if(wrangler(['d1','export','sickstyle-db','--remote','--output',backupFile],{stdio:'inherit'}).status!==0)
        throw Error('本番バックアップが未完了です。反映しません');
      const backup={file:relative(root,backupFile),...verifySqlBackup(backupFile)};
      writeFileSync(resolve(directory,'previous-versions.json'),JSON.stringify(previous,null,2)+'\n',{mode:0o600,flag:'wx'});
      writeFileSync(resolve(directory,'rollback.json'),JSON.stringify({command:[process.execPath,'node_modules/wrangler/bin/wrangler.js',...rollbackArgs(previous)],
        note:'コードだけを戻す。AI保存v2/分割形式を旧Versionが読めない場合はAIを停止して確認。DBを無断で復元・削除しない。'},null,2)+'\n',{mode:0o600,flag:'wx'});
      await confirmed('コード専用Version方式でSecrets・Variables・DBスキーマ・Cron・ルートを変更しないことを確認しましたか？');
      await confirmed('直前Versionへの復旧方法とAI保存形式の互換性を確認しましたか？ 未確認ならNで停止してください');
      mkdirSync(dirname(receiptPath),{recursive:true,mode:0o700});
      writeFileSync(receiptPath,JSON.stringify({version:1,head,worker:config.name,account_id:config.account_id,
        database_id:config.d1_databases[0].database_id,checked_at:new Date().toISOString(),previous_versions:previous,
        free_and_zero_cost_confirmed:true,settings_preservation_confirmed:true,rollback_compatibility_confirmed:true,
        review_confirmed:true,validation_confirmed:true,review,backup},null,2)+'\n',{mode:0o600});
      console.log('事前確認を保存しました。本番コードは未変更です。\n'+receiptPath);
      process.exit(0);
    }
    let receipt;
    try{receipt=JSON.parse(readFileSync(receiptPath,'utf8'));}catch{throw Error('最新SHAの事前確認がありません。npm run deploy:preflight が必要です');}
    checkReadiness(root,head,config,receipt,reviewBase);
    if(JSON.stringify(currentVersions())!==JSON.stringify(receipt.previous_versions))throw Error('本番Versionが事前確認後に変わりました。再確認が必要です');
    if (run('npm',['test'],{stdio:'inherit'}).status !== 0) throw Error('テスト失敗のため停止しました');
    if (run('npm',['run','build'],{stdio:'inherit'}).status !== 0) throw Error('ビルド失敗のため停止しました');
    if (git(['rev-parse','HEAD']) !== head || git(['status','--porcelain'])) throw Error('テスト中にコードが変更されました');
    const path = versionConfig(config);
    try {
      const tag = 'sickstyle-'+head.slice(0,12)+'-'+randomUUID().slice(0,8);
      console.log('反映対象SHA: '+head+' / Version tag: '+tag);
      if(wrangler(['versions','upload','--config',path,'--keep-vars','--dry-run'],{stdio:'inherit'}).status!==0)
        throw Error('コード専用dry-runが失敗したため停止しました');
      // Native version operations preserve schedules and routes. Upload never changes live traffic.
      if (wrangler(['versions','upload','--config',path,'--keep-vars','--strict','--tag',tag,
          '--message','SICK STYLE AI team '+head.slice(0,12)],{stdio:'inherit'}).status !== 0)
        throw Error('Versionアップロード未完了。本番トラフィックは切り替えていません');
      checkReadiness(root,head,config,receipt,reviewBase);
      if(git(['rev-parse','HEAD'])!==head||git(['status','--porcelain'])||
          git(['ls-remote','--heads','origin','ai-staff/phase4-runtime']).split(/\s/)[0]!==head||
          git(['ls-remote','--heads','origin','claude/initial-github-sync']).split(/\s/)[0]!==reviewBase||
          JSON.stringify(currentVersions())!==JSON.stringify(receipt.previous_versions))
        throw Error('コードまたは本番Versionが変わりました。切り替えず停止します');
      if (wrangler(['versions','deploy','--config',path,'--version-tag',tag+'@100',
          '--yes','--message','SICK STYLE '+head.slice(0,12)],{stdio:'inherit'}).status !== 0)
        throw Error('本番切り替え未確認。CloudflareのDeploymentsで状態を確認してください');
      const deployed=currentVersions();
      writeFileSync(resolve(dirname(receiptPath),head+'-deployed.json'),JSON.stringify({head,tag,versions:deployed,
        previous_versions:receipt.previous_versions,deployed_at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
      console.log('反映後Version: '+deployed.map(v=>v.version_id+'@'+v.percentage).join(', '));
      if (run(process.execPath,['scripts/verify-existing.js'],{stdio:'inherit'}).status !== 0)
        throw Error('反映後の読み取り検証が失敗しました。Deploymentsから直前VersionへのRollbackを検討してください');
      console.log('コードの本番反映と公開・未認証応答を確認しました。本人ログイン後のAI社員操作は管理画面で確認してください。');
    } finally { rmSync(path,{force:true}); }
  }
} catch (error) { console.error(error.code ? 'ローカル設定・CLIの状態を確認してください' : error.message); process.exitCode=1; }
