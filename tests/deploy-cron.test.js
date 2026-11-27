import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyLiveCron} from '../scripts/lib/deploy-cron.js';
const config={account_id:'test-account',name:'test-worker',triggers:{crons:['* * * * *','0 0 * * *']}};
test('scheduled release verification is read-only and accepts unordered schedules',async()=>{
 let calls=0;
 const request=async(url,init)=>{
  calls++;
  assert.equal(url.href,'https://api.cloudflare.com/client/v4/accounts/test-account/workers/scripts/test-worker/schedules');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  return Response.json({success:true,result:{schedules:[{cron:'0 0 * * *'},{cron:'* * * * *'}]}});
 };
 assert.equal(await verifyLiveCron(config,'dummy',request),2);assert.equal(calls,1);
});
test('missing or duplicate live schedules stop release; unreadable results fail closed',async()=>{
 const read=rows=>async()=>Response.json({success:true,result:{schedules:rows}});
 for(const rows of [[{cron:'0 0 * * *'}],[{cron:'0 0 * * *'},{cron:'0 0 * * *'}]])
  await assert.rejects(verifyLiveCron(config,'dummy',read(rows)),/不一致/);
 await assert.rejects(verifyLiveCron(config,'dummy',async()=>Response.json({success:true,result:{}})),/確認できません/);
 await assert.rejects(verifyLiveCron(config,null,async()=>assert.fail('must not call API')),/認証/);
});
