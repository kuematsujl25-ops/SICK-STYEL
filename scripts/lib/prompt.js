// 対話ターミナル専用の入力ヘルパー。パスワードは画面・引数・ログに出しません。
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
export function requireTerminal(){
 if(!stdin.isTTY||!stdout.isTTY)throw Error('このコマンドは「ターミナル」アプリで直接実行してください（パスワードを引数やログに出さないため）。');
}
// 直前に stdio:'inherit' の子プロセス（実際のD1エクスポートなど、時間のかかる処理）が
// 動いている間に押されたEnter/キー入力は、端末（OS）側に行バッファとして溜まったまま残り、
// 次の質問を開いた瞬間に「本人が見る前の答え」として誤って消費されてしまうことがある。
// 新しい質問を出す前に、既に溜まっている入力を読み捨ててから聞く。
async function drainStaleInput(){
 if(!stdin.isTTY)return;
 stdin.resume();
 await new Promise(r=>setTimeout(r,50)); // OS側の行バッファがNodeのストリームへ届くのを待つ。
 let chunk;while((chunk=stdin.read())!==null);
}
// 直前に stdio:'inherit' の子プロセス（wranglerの進捗表示など）が実行されていると、
// 端末がraw modeのまま・カーソル位置が不定のまま残ることがあり、確認プロンプトが
// 見えない／入力を受け付けないように見える。質問の前に明示的に改行してcooked modeへ戻す。
export async function ask(prompt){
 if(stdin.isTTY){try{stdin.setRawMode(false);}catch{}}
 await drainStaleInput();
 stdout.write('\n');
 const rl=createInterface({input:stdin,output:stdout});try{return (await rl.question(prompt)).trim();}finally{rl.close();}
}
export function secret(prompt){
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');let value='';
 return new Promise((resolve,reject)=>{
  function done(){stdin.off('data',data);stdin.setRawMode(false);stdin.pause();stdout.write('\n');}
  function data(chunk){for(const c of chunk){if(c==='\u0003'){done();reject(Error('中止しました'));return;}if(c==='\r'||c==='\n'){done();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}}
  stdin.on('data',data);
 });
}
export async function askCredentials(){
 const email=(await ask('管理者メールアドレス（ログインIDになります）: ')).toLowerCase();
 if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)throw Error('メールアドレスの形式が正しくありません');
 console.log('このアプリ専用のパスワードを決めてください。Instagram・Amazon・メールのパスワードとは別のものを推奨します。');
 const password=await secret('パスワード（12〜256文字・入力しても画面には表示されません）: ');
 if(password.length<12||password.length>256)throw Error('パスワードは12〜256文字にしてください');
 const confirm=await secret('確認のためもう一度入力（非表示）: ');
 if(password!==confirm)throw Error('パスワードが一致しません。もう一度実行してください');
 return {email,password};
}
