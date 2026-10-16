// Workers が無料プランであることを確認し、.cloudflare-free.json（24時間有効）に記録します。支払い・プラン変更APIは呼びません。
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {ask} from './prompt.js';
export function cfToken(){const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});try{return JSON.parse(r.stdout).token;}catch{return null;}}
export function freeCheckValid(accountId){if(!existsSync('.cloudflare-free.json'))return false;const c=JSON.parse(readFileSync('.cloudflare-free.json','utf8'));const t=Date.parse(c.checkedAt);return c.plan==='free'&&c.accountId===accountId&&Number.isFinite(t)&&t<=Date.now()+300000&&Date.now()-t<=86400000&&String(c.source||'').startsWith('https://dash.cloudflare.com/');}
export async function ensureFree(accountId){
 if(freeCheckValid(accountId))return;
 const dash=`https://dash.cloudflare.com/${accountId}/workers/plans`;const tok=cfToken();let how=null;
 if(tok){const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/subscriptions`,{headers:{Authorization:'Bearer '+tok}});const b=await r.json().catch(()=>({}));if(r.ok&&b.success!==false){const paid=(b.result||[]).filter(s=>/worker/i.test(JSON.stringify(s.rate_plan||s.product||s))&&Number(s.price||0)>0);if(paid.length)throw Error('有料のWorkersプランが有効なため停止しました。');how='api';console.log('有料のWorkers契約はありません（無料プラン）。');}}
 if(!how){if(!process.stdin.isTTY)throw Error('無料プランの確認が必要です。ターミナルで実行してください');console.log(`ブラウザーで ${dash} を開き、Workers のプランが「Free」か確認してください。`);if(!/^(y|yes|はい)$/i.test(await ask('「Free」と表示されていますか？ [y/N]: ')))throw Error('無料プランを確認できないため停止しました');how='owner-confirmed';}
 writeFileSync('.cloudflare-free.json',JSON.stringify({accountId,plan:'free',checkedAt:new Date().toISOString(),source:dash,method:how},null,2)+'\n',{mode:0o600});
}
