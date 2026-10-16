import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const checkFile='.cloudflare-free.json';
if(!existsSync(checkFile))throw Error('公開前にCloudflareダッシュボードでWorkers Freeを確認してください。検証済みのアカウントID・確認日時を.cloudflare-free.jsonへ記録してから公開します。課金プランへの切替は行いません。');
const check=JSON.parse(readFileSync(checkFile,'utf8'));
if(check.plan!=='free'||!check.accountId||check.accountId!==config.account_id||!Number.isFinite(Date.parse(check.checkedAt))||Date.parse(check.checkedAt)>Date.now()+300000||Date.now()-Date.parse(check.checkedAt)>86400000||!check.source?.startsWith('https://dash.cloudflare.com/'))throw Error('対象アカウントの無料プラン確認が無効です。再確認してください');
if(config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')throw Error('本物のD1データベースを接続してから公開してください');
if(!config.workers_dev||config.routes?.length)throw Error('無料のworkers.dev標準URLだけを使用してください');
if(config.r2_buckets||config.durable_objects||config.queues||config.ai||config.browser||config.images||config.containers)throw Error('不要なサービスへの接続があるため停止しました');
const run=(args)=>{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:check.accountId}});if(r.status!==0)process.exit(r.status||1);};
run(['deploy']);
// bulk only writes server-side secrets; never emits their values. No billing API is invoked.
if(existsSync('.env.bootstrap'))run(['secret','bulk','.env.bootstrap']);
console.log('無料のWorkers/D1構成をデプロイしました。続けて実URLで検証してください。');
