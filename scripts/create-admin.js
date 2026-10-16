import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {loadLocalEnv} from '../lib/local-env.js';
import {createStore} from '../lib/store.js';
import {scrypt,token} from '../lib/security.js';
const root=fileURLToPath(new URL('../',import.meta.url));loadLocalEnv(root);
if(!stdin.isTTY||!stdout.isTTY)throw Error('管理者作成は本人の対話ターミナルで実行してください（パスワードを引数やログに出さないため）');
if(process.env.DATABASE_URL||process.env.NODE_ENV==='production')throw Error('このコマンドはローカルSQLite専用です。クラウドでは初期設定画面を使用してください');
const db=await createStore();if((await db.query('SELECT id FROM ss_users WHERE id=1')).length){db.close();console.log('管理者は登録済みです。既存アカウントでログインしてください。変更はしていません。');process.exit(0);}
const rl=createInterface({input:stdin,output:stdout});const email=(await rl.question('管理者メールアドレス: ')).trim().toLowerCase();rl.close();
async function secret(prompt){stdout.write(prompt);stdin.setRawMode(true);stdin.resume();let value='';return new Promise((resolve,reject)=>{function done(){stdin.off('data',data);stdin.setRawMode(false);stdin.pause();stdout.write('\n');}function data(buf){for(const c of buf.toString()){if(c==='\u0003'){done();reject(Error('中止しました'));return;}if(c==='\r'||c==='\n'){done();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}}stdin.on('data',data);});}
try{const password=await secret('パスワード（12〜256文字、画面には表示されません）: ');const confirm=await secret('もう一度入力（非表示）: ');if(password!==confirm)throw Error('パスワードが一致しません');if(password.length<12||password.length>256||!/^\S+@\S+\.\S+$/.test(email))throw Error('入力形式が正しくありません');
 const salt=token();const digest=(await scrypt(password,salt,64)).toString('hex');await db.query('INSERT INTO ss_users(id,email,hash,salt) VALUES (1,$1,$2,$3)',[email,digest,salt]);console.log('管理者を作成しました。ブラウザーを再読み込みしてログインしてください。');}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
