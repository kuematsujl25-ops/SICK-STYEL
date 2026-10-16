// Cloudflare D1 へのパラメーター化クエリー（Wranglerのログイン情報を使用。トークンは表示・保存しません）。
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
export function remoteD1(){
 const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8'));const db=cfg.d1_databases?.[0];
 if(!cfg.account_id||!db?.database_id||db.database_id==='00000000-0000-0000-0000-000000000000')throw Error('公開用のD1が未設定です。先に npm run cloud:setup を実行してください');
 const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 let token;try{token=JSON.parse(r.stdout).token;}catch{}if(!token)throw Error('Cloudflareにログインしていません。npx wrangler login を実行してください');
 return {name:db.database_name,async query(sql,params=[]){const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.account_id}/d1/database/${db.database_id}/query`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});const b=await res.json().catch(()=>({}));if(!res.ok||!b.success)throw Error('D1の操作に失敗しました ('+res.status+') '+(b.errors||[]).map(e=>e.message).join(' '));return b.result?.[0]?.results||[];}};
}
