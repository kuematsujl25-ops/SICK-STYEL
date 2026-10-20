import {provenance,authorizationScope} from '../scripts/ai-staff/observation-provenance.js';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {identityFromAuth,verifyIdentity,verifyUsageObservation} from '../scripts/ai-staff/account-identity.js';
import {applicability,authIdentity} from './helpers/policy-applicability.js';
import {collectApplicability,DOCTOR_REMOTE_LINE,parseApplicabilityDiagnostics} from '../scripts/ai-staff/policy-applicability.js';
const auth=()=>({...applicability().credential,...authIdentity()});
const usage=()=>({version:2,source:'claude.ai_account_and_usage_ui',observation:provenance('usage'),checked_at:new Date().toISOString(),
 browser_account_sha256:applicability().identity.account_sha256,cli_identity_sha256:applicability().identity.identity_sha256,
 subscription_type:'pro',extra_usage_enabled:false,usage_available:true,evidence_ref:'/synthetic/ui-evidence',evidence_sha256:'e'.repeat(64)});
const ok=stdout=>({status:0,signal:null,stderr:'',stdout});
const context={executable:applicability().executable,executable_sha256:applicability().executable_sha256};
test('同一本人/組織は正規化して一致、token/生emailを診断証拠へ残さない',()=>{
 const original=identityFromAuth(auth());
 assert.deepEqual(original,identityFromAuth({...auth(),email:' OPERATOR@EXAMPLE.COM ',orgId:' '+auth().orgId.toUpperCase()+' '}));
 const parsed=parseApplicabilityDiagnostics({context,version:ok('2.1.296 (Claude Code)'),doctor:ok(DOCTOR_REMOTE_LINE),
  auth:ok(JSON.stringify({...auth(),accessToken:'synthetic-token-not-for-retention'}))});
 assert.deepEqual(parsed.identity,original);
 assert.ok(!JSON.stringify(parsed).includes('operator@example.com'));
 assert.ok(!JSON.stringify(parsed).includes(auth().orgId));
 assert.ok(!JSON.stringify(parsed).includes('synthetic-token-not-for-retention'));
});
test('本人/組織識別子の欠落・不正型・不正形式は拒否',()=>{
 for(const key of ['email','orgId']){
  const a=auth();delete a[key];assert.throws(()=>identityFromAuth(a));
  for(const value of [null,42,{},[],true,'','\n','bad'])assert.throws(()=>identityFromAuth({...auth(),[key]:value}));
 }
 assert.throws(()=>verifyIdentity({...applicability().identity,org_sha256:'e'.repeat(64)}));
});
test('ブラウザ利用枠・承認に結合した本人/組織から切替後は拒否、期限を延ばさない',()=>{
 const proof=usage();assert.equal(verifyUsageObservation(proof,applicability().identity),proof);
 for(const patch of [{email:'other@example.com'},{orgId:'22222222-2222-4222-8222-222222222222'}])
  assert.throws(()=>verifyUsageObservation(proof,identityFromAuth({...auth(),...patch})));
 for(const key of Object.keys(proof)){const p={...proof};delete p[key];assert.throws(()=>verifyUsageObservation(p,applicability().identity),key);}
 for(const patch of [{extra_usage_enabled:true},{usage_available:false},{checked_at:new Date(Date.now()-610000).toISOString()},
  {browser_account_sha256:'f'.repeat(64)},{cli_identity_sha256:'f'.repeat(64)}])
  assert.throws(()=>verifyUsageObservation({...proof,...patch},applicability().identity));
});
test('doctor前後で同じProの別account/別orgへ切り替わった場合も停止',()=>{
 for(const patch of [null,{email:'other@example.com'},{orgId:'22222222-2222-4222-8222-222222222222'}]){
  let count=0;
  const run=(exe,args)=>{
   if(args[0]==='--version')return ok('2.1.296 (Claude Code)');
   if(args[0]==='doctor')return ok(DOCTOR_REMOTE_LINE);
   return ok(JSON.stringify({...auth(),...(++count===2?patch:{})}));
  };
  const check=()=>collectApplicability({home:'/synthetic',env:{HOME:'/synthetic'},cwd:'/synthetic',run,readContext:()=>context});
  if(patch)assert.throws(check);else assert.deepEqual(check(),applicability());
 }
});
