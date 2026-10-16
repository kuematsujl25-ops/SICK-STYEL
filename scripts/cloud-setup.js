// 1コマンドで Cloudflare Workers Free + D1 に公開します（Macの「ターミナル」で本人が実行）。
//   cd ~/Sites/SICK-STYEL && npm run cloud:setup
// ・Cloudflareへのログイン（公式OAuth）はブラウザーで本人が行います。トークンは表示・保存しません（Wranglerの保管領域のみ）。
// ・有料プラン・トライアル・独自ドメインは使いません。支払い・プラン変更APIは呼びません。
// ・再実行しても既存のD1・データは上書きしません。
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ask} from './lib/prompt.js';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error(`Node.js ${process.versions.node} では実行できません。Node.js 24 をインストールしてください（https://nodejs.org/ja）。`);
if(!process.stdin.isTTY)throw Error('「ターミナル」アプリで直接実行してください');
const step=(n,t)=>console.log(`\n[${n}/8] ${t}`);
const W=['node_modules/wrangler/bin/wrangler.js'];
const env={...process.env,WRANGLER_SEND_METRICS:'false'};
const wr=(args,opt={})=>spawnSync(process.execPath,[...W,...args],{encoding:'utf8',env,...opt});
const yes=async q=>/^(y|yes|はい)$/i.test(await ask(q+' [y/N]: '));
if(!existsSync(W[0])){console.log('依存パッケージをインストールします…');const r=spawnSync('npm',['ci'],{stdio:'inherit'});if(r.status)process.exit(1);}
// 1. ログイン
step(1,'Cloudflareアカウントの確認');
let who=wr(['whoami','--json']);
if(who.status!==0){console.log('ブラウザーでCloudflareのログイン画面が開きます。ログイン（未登録なら無料アカウントを作成）し、「Allow」を押してください。カード登録・有料プランは不要です。');const r=wr(['login'],{stdio:'inherit',encoding:undefined});if(r.status!==0)throw Error('ログインが完了しませんでした。もう一度実行してください');who=wr(['whoami','--json']);}
const user=JSON.parse(who.stdout);const accounts=user.accounts||[];if(!accounts.length)throw Error('Cloudflareアカウントが見つかりません');
let account=accounts[0];if(accounts.length>1){accounts.forEach((a,i)=>console.log(`  ${i+1}) ${a.name}`));account=accounts[Number(await ask('使用するアカウントの番号: '))-1];if(!account)throw Error('番号が正しくありません');}
console.log(`ログイン中: ${user.email||'(メール非表示)'} / アカウント: ${account.name}`);
const tok=JSON.parse(wr(['auth','token','--json']).stdout||'{}').token;if(!tok)throw Error('認証情報を取得できませんでした。npx wrangler login をやり直してください');
async function cf(path,opt={}){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{...opt,headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json',...(opt.headers||{})}});const b=await r.json().catch(()=>({}));return {ok:r.ok&&b.success!==false,status:r.status,body:b};}
// 2. 無料プランの確認
step(2,'Workersが無料プランであることの確認');
const dash=`https://dash.cloudflare.com/${account.id}/workers/plans`;
const subs=await cf(`/accounts/${account.id}/subscriptions`);let free=false,how='';
if(subs.ok){const paid=(subs.body.result||[]).filter(s=>/worker/i.test(JSON.stringify(s.rate_plan||s.product||s))&&Number(s.price||0)>0);if(paid.length)throw Error('有料のWorkersプランが有効なため停止しました（このアプリは無料プランでのみ公開します）。');free=true;how='api:'+`/accounts/${account.id}/subscriptions`;console.log('有料のWorkers契約はありません（無料プラン）。');}
else{console.log(`プラン情報をAPIで読めませんでした。ブラウザーで ${dash} を開き、Workers のプランが「Free」になっているか確認してください。`);free=await yes('「Free」と表示されていますか？');how='owner-confirmed';}
if(!free)throw Error('無料プランを確認できないため停止しました。有料プランへの変更は行いません。');
writeFileSync('.cloudflare-free.json',JSON.stringify({accountId:account.id,plan:'free',checkedAt:new Date().toISOString(),source:dash,method:how},null,2)+'\n',{mode:0o600});
// 3. 設定ファイル
step(3,'wrangler.jsonc にアカウントを設定');
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));cfg.account_id=account.id;
// 4. D1
step(4,'無料のD1データベースを準備');
const dbName=cfg.d1_databases[0].database_name;
const list=await cf(`/accounts/${account.id}/d1/database?name=${encodeURIComponent(dbName)}`);if(!list.ok)throw Error('D1の一覧を取得できませんでした ('+list.status+')');
let db=(list.body.result||[]).find(d=>d.name===dbName);
if(db)console.log(`既存のD1「${dbName}」を使用します（データは上書きしません）。`);
else{const c=await cf(`/accounts/${account.id}/d1/database`,{method:'POST',body:JSON.stringify({name:dbName,primary_location_hint:'apac'})});if(!c.ok)throw Error('D1を作成できませんでした ('+c.status+') '+JSON.stringify(c.body.errors||[]));db=c.body.result;console.log(`D1「${dbName}」を作成しました（アジア太平洋）。`);}
cfg.d1_databases[0].database_id=db.uuid||db.id;
writeFileSync('wrangler.jsonc',JSON.stringify(cfg,null,2)+'\n');
// 5. workers.dev サブドメイン
step(5,'無料の workers.dev URL を確認');
let sub=await cf(`/accounts/${account.id}/workers/subdomain`);let subdomain=sub.ok?sub.body.result?.subdomain:null;
while(!subdomain){const name=(await ask('workers.dev のサブドメイン名を決めてください（英小文字・数字・ハイフン。例: sickstyle-'+Math.random().toString(36).slice(2,6)+'）: ')).toLowerCase();if(!/^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$/.test(name)){console.log('形式が正しくありません');continue;}const r=await cf(`/accounts/${account.id}/workers/subdomain`,{method:'PUT',body:JSON.stringify({subdomain:name})});if(r.ok)subdomain=name;else console.log('使用できません。別の名前にしてください。');}
const url=`https://${cfg.name}.${subdomain}.workers.dev`;console.log('公開URL: '+url);
cfg.vars={...cfg.vars,APP_ORIGIN:url};writeFileSync('wrangler.jsonc',JSON.stringify(cfg,null,2)+'\n');
// 6. テストと公開
step(6,'テスト → 公開（スキーマ作成・デプロイ・秘密値の登録）');
let r=spawnSync('npm',['test'],{stdio:'inherit'});if(r.status)throw Error('テストが失敗したため公開を中止しました');
r=spawnSync(process.execPath,['scripts/cloudflare-deploy.js'],{stdio:'inherit',env:{...env,CLOUDFLARE_ACCOUNT_ID:account.id}});if(r.status)throw Error('公開に失敗しました');
writeFileSync('.deployment.json',JSON.stringify({url,accountName:account.name,database:dbName,deployedAt:new Date().toISOString()},null,2)+'\n');
// 7. 管理者
step(7,'公開版の管理者');
r=spawnSync(process.execPath,['scripts/create-admin-remote.js'],{stdio:'inherit',env:{...env,CLOUDFLARE_ACCOUNT_ID:account.id}});if(r.status)console.log('管理者作成は未完了です。あとで npm run admin:create:remote を実行してください。');
// 8. 動作確認
step(8,'公開URLでの動作確認');
let verified=null;if(await yes('いま作成した管理者で動作確認（一時データの登録・更新・削除）を実行しますか？')){r=spawnSync(process.execPath,['scripts/verify-deployment.js',url],{stdio:'inherit'});verified=r.status===0;}
console.log(verified===false?`\n公開は完了しましたが、動作確認が失敗しました。上のメッセージを確認してください（URL: ${url}）。`:`\n公開が完了しました。スマートフォンで ${url} を開いてログインしてください。`);
