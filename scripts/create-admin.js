// ローカル（このPCのSQLite）に最初の管理者を作成します。既存の管理者は上書きしません。
import {fileURLToPath} from 'node:url';
import {loadLocalEnv} from '../lib/local-env.js';
import {requireTerminal,askCredentials} from './lib/prompt.js';
import {hashPassword} from '../lib/password.js';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw Error(`Node.js ${process.versions.node} では実行できません。Node.js 24 をインストールしてから再実行してください（https://nodejs.org/ja）。`);
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);loadLocalEnv(root);
requireTerminal();
if(process.env.DATABASE_URL||process.env.NODE_ENV==='production')throw Error('このコマンドはローカル専用です。公開版は npm run admin:create:remote を使用してください');
const {createStore}=await import('../lib/store.js');
const db=await createStore();
try{
 if((await db.query('SELECT id FROM ss_users WHERE id=1')).length){console.log('管理者は登録済みです（変更していません）。既存のメールアドレスとパスワードでログインしてください。');process.exit(0);}
 console.log('SICKSTYLE ローカル管理者の作成（保存先: このPCの data/sickstyle.sqlite）');
 const {email,password}=await askCredentials();
 const {hash,salt}=await hashPassword(password);
 const row=await db.query('INSERT INTO ss_users(id,email,hash,salt) VALUES (1,$1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id',[email,hash,salt]);
 if(!row.length){console.log('同時に別の管理者が作成されたため変更していません。');process.exit(0);}
 console.log('管理者を作成しました。ブラウザーで http://127.0.0.1:3000 を開き（表示中なら再読み込みし）、このメールアドレスとパスワードでログインしてください。');
}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
