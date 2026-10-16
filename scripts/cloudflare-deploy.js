// Cloudflare Workers Free + D1 へ公開します。課金・プラン変更APIは呼びません。
// 本番の秘密値はローカル開発用とは別に生成し（.env.production.secrets、Git対象外・権限600）、値を表示せずSecretsへ登録します。
// 本番には SETUP_TOKEN を登録しません（Web上の初回登録は閉じたまま。管理者は npm run admin:create:remote で作成）。
import {readFileSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const checkFile='.cloudflare-free.json';
if(!existsSync(checkFile))throw Error('公開前にCloudflareダッシュボードでWorkersのプランがFreeであることを確認し、.cloudflare-free.json に記録してください。課金プランへの切替は行いません。');
const check=JSON.parse(readFileSync(checkFile,'utf8'));
if(check.plan!=='free'||!check.accountId||check.accountId!==config.account_id||!Number.isFinite(Date.parse(check.checkedAt))||Date.parse(check.checkedAt)>Date.now()+300000||Date.now()-Date.parse(check.checkedAt)>86400000||!check.source?.startsWith('https://dash.cloudflare.com/'))throw Error('対象アカウントの無料プラン確認が無効です（24時間以内の確認記録が必要）。再確認してください');
if(config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')throw Error('本物のD1データベースを接続してから公開してください');
if(!config.workers_dev||config.routes?.length||config.route)throw Error('無料のworkers.dev標準URLだけを使用してください');
if(config.r2_buckets||config.durable_objects||config.queues||config.ai||config.browser||config.images||config.containers||config.kv_namespaces||config.limits)throw Error('不要なサービスへの接続があるため停止しました');
const secretsFile='.env.production.secrets';
const secrets=existsSync(secretsFile)?JSON.parse(readFileSync(secretsFile,'utf8')):{};
if(!secrets.TOKEN_ENCRYPTION_KEY)secrets.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
for(const k of ['CRON_SECRET','META_WEBHOOK_VERIFY_TOKEN'])if(!secrets[k])secrets[k]=randomBytes(32).toString('base64url');
delete secrets.SETUP_TOKEN;
writeFileSync(secretsFile,JSON.stringify(secrets,null,2)+'\n',{mode:0o600});chmodSync(secretsFile,0o600);
const env={...process.env,CLOUDFLARE_ACCOUNT_ID:check.accountId,WRANGLER_SEND_METRICS:'false'};
const run=args=>{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit',env});if(r.status!==0)process.exit(r.status||1);};
run(['d1','migrations','apply',config.d1_databases[0].database_name,'--remote']);
run(['deploy']);
run(['secret','bulk',secretsFile]);
console.log('無料のWorkers/D1構成をデプロイしました（秘密値は表示していません）。公開URLで動作確認してください。');
