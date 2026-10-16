// 公開版（Cloudflare D1）に最初の管理者を作成します。
// Cloudflareへログイン済みのこのPCのターミナルからのみ実行できます。Web上の初期登録を公開せずに済みます。
// パスワードはこのPCでハッシュ化し、平文は送信・保存・表示しません。既存の管理者は上書きしません。
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,rmSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {requireTerminal,askCredentials} from './lib/prompt.js';
import {hashPassword} from '../lib/password.js';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
requireTerminal();
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));const name=config.d1_databases?.[0]?.database_name;
if(!name||config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')throw Error('公開用のD1データベースが未作成です。先にデプロイ手順を完了してください');
function wrangler(args){const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute',name,'--remote','--json',...args],{encoding:'utf8',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:config.account_id||process.env.CLOUDFLARE_ACCOUNT_ID,WRANGLER_SEND_METRICS:'false'}});if(r.status!==0)throw Error('Cloudflare D1へ接続できませんでした。npx wrangler login でログイン済みか確認してください。');return JSON.parse(r.stdout);}
const count=()=>Number(wrangler(['--command','SELECT COUNT(*) AS n FROM ss_users'])[0]?.results?.[0]?.n);
if(count()>0){console.log('公開版の管理者は登録済みです（変更していません）。登録済みのメールアドレスとパスワードでログインしてください。');process.exit(0);}
console.log(`SICKSTYLE 公開版の管理者作成（保存先: Cloudflare D1「${name}」）`);
const {email,password}=await askCredentials();
const {hash,salt}=await hashPassword(password);
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const dir=mkdtempSync(path.join(tmpdir(),'ss-admin-'));const file=path.join(dir,'admin.sql');
try{
 // INSERTのみ（UPDATEなし）。id=1の主キー制約で、既存管理者がいれば失敗し上書きしません。
 writeFileSync(file,`INSERT INTO ss_users(id,email,hash,salt) VALUES(1,${q(email)},${q(hash)},${q(salt)});\n`,{mode:0o600});
 try{wrangler(['--file',file,'--yes']);}catch(e){if(count()>0)throw Error('別の管理者が既に登録されていたため作成していません。');throw e;}
}finally{rmSync(dir,{recursive:true,force:true});}
if(count()!==1)throw Error('作成を確認できませんでした。もう一度実行してください');
console.log('公開版の管理者を作成しました。スマートフォン等で公開URLを開き、このメールアドレスとパスワードでログインしてください。Web上の初回登録は閉じています。');
