// 既定は変更しない計画表示。承認後の --apply と端末での明示確認だけが本番Secretsを変更します。
//   npm run integrations:instagram   /   npm run integrations:amazon
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ask,secret,requireTerminal} from './lib/prompt.js';
import {registrationPlan} from './lib/integration-plan.js';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));const origin=cfg.vars?.APP_ORIGIN;
const [target,...flags]=process.argv.slice(2);
if(flags.some(f=>!['--plan','--apply'].includes(f))||new Set(flags).size!==flags.length||flags.length>1)throw Error('使い方: node scripts/set-secrets.js instagram|amazon|amazon-refresh|zoom|googlecalendar [--plan|--apply]');
const registration=registrationPlan(cfg,target);
if(!flags.includes('--apply')){console.log(JSON.stringify(registration,null,2));process.exit(0);}
requireTerminal();
console.log('本番Secretsへの即時反映を伴います。Issue #2では現在許可されていません。別途、本番反映を含む明示承認がある場合だけ続けてください。');
console.log('変更先Worker: '+registration.worker+' / '+registration.origin);
console.log('変更する設定名: '+[...registration.requiredNames,...registration.optionalNames].join(', '));
if(await ask('承認済みの場合だけ REGISTER '+registration.worker+' と入力: ')!=='REGISTER '+registration.worker)throw Error('登録を中止しました。変更はありません。');
const plans={
 instagram:{title:'Instagram（Meta）',fields:[['INSTAGRAM_APP_ID','Instagram App ID（数字）',false,/^\d{5,30}$/],['INSTAGRAM_APP_SECRET','Instagram App Secret（非表示で入力）',true,/^[0-9a-f]{16,64}$/i]],note:`Metaの「Business login settings」の OAuth redirect URIs に次を登録済みか確認してください:\n  ${origin}/api/instagram/callback`},
 amazon:{title:'Amazon SP-API',fields:[['AMAZON_LWA_CLIENT_ID','LWA クライアントID（amzn1.application-oa2-client. で始まる）',false,/^amzn1\.application-oa2-client\.[0-9a-z]+$/],['AMAZON_LWA_CLIENT_SECRET','LWA クライアントシークレット（非表示で入力）',true,/^\S{20,}$/],['AMAZON_APP_ID','アプリID（amzn1.sp.solution. で始まる。セルフ認可のみなら空欄でEnter）',false,/^(amzn1\.sp\.solution\.[0-9a-z-]+)?$/]],note:`自社アカウントはセルフ認可を推奨します（アプリIDは空欄でEnter）。この後 npm run integrations:amazon-refresh でリフレッシュトークンを登録します。\n（Webサイト認可を使う場合のみ: OAuthログインURI ${origin}/api/amazon/login / リダイレクトURI ${origin}/api/amazon/callback）`},
 'amazon-refresh':{title:'Amazon セルフ認可のリフレッシュトークン',fields:[['AMAZON_REFRESH_TOKEN','リフレッシュトークン（Atzr| で始まる・非表示で入力）',true,/^Atzr\|\S+$/]],note:''},
 zoom:{title:'Zoom（団体営業MTGの自動発行）',fields:[['ZOOM_CLIENT_ID','Zoom OAuthアプリ Client ID',false,/^[A-Za-z0-9_-]{8,64}$/],['ZOOM_CLIENT_SECRET','Zoom OAuthアプリ Client Secret（非表示で入力）',true,/^[A-Za-z0-9_-]{8,128}$/]],note:`Zoom App MarketplaceのOAuthアプリ（ユーザー認可が必要なタイプ）で、Redirect URLに次を登録済みか確認してください:\n  ${origin}/api/zoom/callback\nScopesはmeeting:write:meeting / meeting:update:meeting / meeting:delete:meeting / user:read:user:meの最小権限のみにしてください。`},
 googlecalendar:{title:'Googleカレンダー（団体営業MTGの自動登録）',fields:[['GOOGLE_CLIENT_ID','Google OAuthクライアントID（.apps.googleusercontent.com で終わる）',false,/^\d+-[0-9a-zA-Z]+\.apps\.googleusercontent\.com$/],['GOOGLE_CLIENT_SECRET','Google OAuthクライアントシークレット（非表示で入力）',true,/^\S{10,100}$/]],note:`Google Cloud ConsoleのOAuthクライアント（ウェブアプリケーション）で、承認済みのリダイレクトURIに次を登録済みか確認してください:\n  ${origin}/api/googlecalendar/callback\nスコープは https://www.googleapis.com/auth/calendar.events のみ。OAuth同意画面の公開ステータスは「本番環境」にしてください（「テスト中」のままだとリフレッシュトークンが7日で失効します）。`},
};
const plan=plans[target];if(!plan)throw Error('使い方: node scripts/set-secrets.js instagram|amazon|amazon-refresh|zoom|googlecalendar');
console.log(`${plan.title} の設定を Cloudflare Secrets に登録します。チャットやGitHubに秘密値を貼らないでください。`);if(plan.note)console.log(plan.note);
const env={...process.env,CLOUDFLARE_ACCOUNT_ID:cfg.account_id,WRANGLER_SEND_METRICS:'false'};
for(const [name,label,,pattern] of plan.fields){
 let v;for(;;){v=(await secret(label+': ')).trim();if(pattern.test(v))break;console.log('形式が正しくありません。コピーし直して再入力してください。');}
 if(!v){console.log(`${name}: 空欄のため登録しません`);continue;}
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put',name],{input:v+'\n',encoding:'utf8',env});
 if(r.status!==0){console.error(`${name} の登録に失敗しました（値は表示していません）。npx wrangler login を確認してください。`);process.exit(1);}console.log(`✓ ${name} を登録しました`);
}
console.log('登録した設定は公開版に反映されています。アプリを再読み込みしてください。');
