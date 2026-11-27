// Compare the live configuration; a code-only deployment never adds or removes triggers.
export async function verifyLiveCron(config,token,request=fetch){
 const desired=config.triggers?.crons;
 if(!Array.isArray(desired)||!desired.length||!token)throw Error('本番Cronの照合に必要な構成またはCloudflare認証がありません');
 const url=new URL('/client/v4/accounts/'+encodeURIComponent(config.account_id)+'/workers/scripts/'+encodeURIComponent(config.name)+'/schedules','https://api.cloudflare.com');
 let res,body;
 try{
  res=await request(url,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10_000)});
  body=await res.json();
 }catch{throw Error('本番Cronを読み取れません。Cloudflareの接続を確認してください');}
 const rows=Array.isArray(body?.result)?body.result:body?.result?.schedules;
 if(!res.ok||body?.success!==true||!Array.isArray(rows)||rows.some(row=>typeof row?.cron!=='string'))
  throw Error('本番Cronを確認できません。Cloudflareの権限・応答を確認してください');
 const sort=values=>values.map(v=>v.trim().replace(/\s+/g,' ')).sort();
 if(JSON.stringify(sort(rows.map(row=>row.cron)))!==JSON.stringify(sort(desired)))
  throw Error('本番Cronとwrangler.jsoncが不一致です。今回は変更せず停止しました。別途承認してdocs/notifications-setup.mdの手順で確認してください');
 return rows.length;
}
