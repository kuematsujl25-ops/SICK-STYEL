// 公開版（Cloudflare D1）に最初の管理者を作成します。Cloudflareにログイン済みのMacのターミナルからのみ実行できます。
// パスワードはこのMacでハッシュ化し、平文は送信・保存・表示しません。既存の管理者は上書きしません。
//   --reset : 既存の管理者とログイン中のセッションを削除してから作り直します（業務データは残ります）。
import {fileURLToPath} from 'node:url';
import {requireTerminal,askCredentials,ask} from './lib/prompt.js';
import {hashPassword} from '../lib/password.js';
import {remoteD1} from './lib/d1-remote.js';
process.chdir(fileURLToPath(new URL('../',import.meta.url)));
requireTerminal();
const d1=remoteD1();const count=async()=>Number((await d1.query('SELECT COUNT(*) AS n FROM ss_users'))[0]?.n||0);
if(process.argv.includes('--reset')){
 if(await count()>0){console.log('公開版の管理者アカウント（メールアドレス・パスワード）を作り直します。目標・タスク等の業務データは削除されません。すべての端末がログアウトされます。');
  if((await ask('続ける場合は「リセット」と入力: '))!=='リセット'){console.log('中止しました（変更なし）。');process.exit(0);}
  await d1.query('DELETE FROM ss_sessions');await d1.query('DELETE FROM ss_users');console.log('既存の管理者を削除しました。続けて新しい管理者を作成します。');}
}else if(await count()>0){console.log('公開版の管理者は登録済みです（変更していません）。\nパスワードを変更したい場合は npm run admin:reset:remote を実行してください。');process.exit(0);}
console.log(`SICKSTYLE 公開版の管理者作成（保存先: Cloudflare D1「${d1.name}」）`);
const {email,password}=await askCredentials();
console.log('Cloudflareに保存しています…（入力は不要です。完了表示までお待ちください）');
const {hash,salt}=await hashPassword(password);
// INSERTのみ（UPDATEなし）。主キー(id=1)制約で既存管理者は上書きされません。
const row=await d1.query('INSERT INTO ss_users(id,email,hash,salt) VALUES (1,?1,?2,?3) ON CONFLICT(id) DO NOTHING RETURNING id',[email,hash,salt]);
if(!row.length){console.log('別の管理者が同時に作成されたため変更していません。');process.exit(1);}
console.log('✓ 公開版の管理者を作成しました。公開URLを開き（表示中なら再読み込みし）、このメールアドレスとパスワードでログインしてください。');
