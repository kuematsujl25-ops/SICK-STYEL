// 連携用の秘密値を Cloudflare Worker の Secrets に登録して公開版へ反映します（値は表示・保存・ログ出力しません）。
//   npm run integrations:instagram   /   npm run integrations:amazon
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ask,secret,requireTerminal} from './lib/prompt.js';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));requireTerminal();
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));const origin=cfg.vars?.APP_ORIGIN;
const target=process.argv[2];
const plans={
 instagram:{title:'Instagram（Meta）',fields:[['INSTAGRAM_APP_ID','Instagram App ID（数字）',false,/^\d{5,30}$/],['INSTAGRAM_APP_SECRET','Instagram App Secret（非表示で入力）',true,/^[0-9a-f]{16,64}$/i]],note:`Metaの「Business login settings」の OAuth redirect URIs に次を登録済みか確認してください:\n  ${origin}/api/instagram/callback`},
 amazon:{title:'Amazon SP-API',fields:[['AMAZON_LWA_CLIENT_ID','LWA クライアントID（amzn1.application-oa2-client. で始まる）',false,/^amzn1\.application-oa2-client\.[0-9a-z]+$/],['AMAZON_LWA_CLIENT_SECRET','LWA クライアントシークレット（非表示で入力）',true,/^\S{20,}$/],['AMAZON_APP_ID','アプリID（amzn1.sp.solution. で始まる。セルフ認可のみなら空欄でEnter）',false,/^(amzn1\.sp\.solution\.[0-9a-z-]+)?$/]],note:`Webサイト認可を使う場合、アプリの設定に次を登録してください:\n  OAuthログインURI: ${origin}/api/amazon/login\n  OAuthリダイレクトURI: ${origin}/api/amazon/callback`},
 'amazon-refresh':{title:'Amazon セルフ認可のリフレッシュトークン',fields:[['AMAZON_REFRESH_TOKEN','リフレッシュトークン（Atzr| で始まる・非表示で入力）',true,/^Atzr\|\S+$/]],note:''},
};
const plan=plans[target];if(!plan)throw Error('使い方: node scripts/set-secrets.js instagram|amazon|amazon-refresh');
console.log(`${plan.title} の設定を Cloudflare Secrets に登録します。値は画面・ログ・Gitに残りません。チャットにも貼らないでください。`);if(plan.note)console.log(plan.note);
const env={...process.env,CLOUDFLARE_ACCOUNT_ID:cfg.account_id,WRANGLER_SEND_METRICS:'false'};
for(const [name,label,hidden,pattern] of plan.fields){
 let v;for(;;){v=(hidden?await secret(label+': '):await ask(label+': ')).trim();if(pattern.test(v))break;console.log('形式が正しくありません。コピーし直して再入力してください。');}
 if(!v){console.log(`${name}: 空欄のため登録しません`);continue;}
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{input:v+'\n',encoding:'utf8',env});
 if(r.status!==0){console.error(`${name} の登録に失敗しました（値は表示していません）。npx wrangler login を確認してください。`);process.exit(1);}console.log(`✓ ${name} を登録しました`);
}
console.log('登録した設定は公開版に反映されています。アプリを再読み込みしてください。');
