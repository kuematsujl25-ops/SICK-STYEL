// Run with BASE_URL, VERIFY_EMAIL, VERIFY_PASSWORD in the environment. Never prints credentials.
import assert from 'node:assert/strict';
const origin=new URL(process.env.BASE_URL||'');if(origin.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('HTTPSの公開URLを指定してください');
const email=process.env.VERIFY_EMAIL,password=process.env.VERIFY_PASSWORD;if(!email||!password)throw Error('VERIFY_EMAIL / VERIFY_PASSWORD が必要です');
const client=()=>({cookie:''});const a=client(),b=client();
async function req(c,route,method='GET',data){const r=await fetch(new URL('/api/'+route,origin),{method,headers:{Cookie:c.cookie,Origin:origin.origin,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});const set=r.headers.get('set-cookie');if(set)c.cookie=set.split(';')[0];return {status:r.status,data:await r.json()};}
assert.equal((await req(a,'data')).status,401);
for(const c of [a,b])assert.equal((await req(c,'login','POST',{email,password})).status,200);
assert.equal((await req(a,'session')).data.storage,'d1','公開版の保存先はCloudflare D1である必要があります');
const id='verify-'+crypto.randomUUID();let wrote=false;
try{
 const snapshot=(await req(a,'data')).data;snapshot.tasks.push({id,title:'公開後検証（一時記録）',due:new Date().toISOString().slice(0,10),priority:'低',done:false});assert.equal((await req(a,'data','PUT',snapshot)).status,200);wrote=true;
 const shared=(await req(b,'data')).data;assert.equal(shared.tasks.some(t=>t.id===id),true);
 assert.equal((await req(a,'logout','POST',{})).status,200);assert.equal((await req(a,'data')).status,401);assert.equal((await req(a,'backup')).status,401);assert.equal((await req(b,'data')).status,200);
 console.log('PASS: ログイン・D1保存・独立した2セッション間の共有・ログアウト後のアクセス拒否');
}finally{
 if(wrote){const latest=(await req(b,'data')).data;latest.tasks=latest.tasks.filter(t=>t.id!==id);assert.equal((await req(b,'data','PUT',latest)).status,200);}
 await req(b,'logout','POST',{});
}
