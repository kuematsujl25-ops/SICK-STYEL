// Cloudflare Workers Free + D1 へ公開します。課金・プラン変更APIは呼びません。
// 本番の秘密値はローカル開発用とは別に生成し（.env.production.secrets、Git対象外・権限600）、値を表示せずSecretsへ登録します。
// 本番には SETUP_TOKEN を登録しません（Web上の初回登録は閉じたまま。管理者は npm run admin:create:remote で作成）。
import {readFileSync,existsSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ensureFree} from './lib/free-check.js';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
await ensureFree(config.account_id);
const check=JSON.parse(readFileSync('.cloudflare-free.json','utf8'));
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
