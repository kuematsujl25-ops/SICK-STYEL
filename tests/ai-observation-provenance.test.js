import {test} from 'node:test';
import assert from 'node:assert/strict';
import {provenance,authorizationScope,verifyObservationBundle} from '../scripts/ai-staff/observation-provenance.js';
import {hash} from '../scripts/ai-staff/delegate-runtime.js';
import {applicability} from './helpers/policy-applicability.js';
import {packet,model,delegate} from './helpers/async-run.js';
const fixture=()=>{
 const checked_at=new Date().toISOString(),identity_sha256=applicability().identity.identity_sha256;
 const ctx={mode:'baseline',delegate,model,packet,inventory:[{path:'/synthetic/settings',sha256:hash('synthetic')}]};
 const envelope=kind=>({version:1,observer:'assistant',kind,checked_at,identity_sha256});
 const p={...envelope('policy'),cli:applicability(),endpoint:{dep_enrolled:false,mdm_enrolled:false,inventory_sha256:hash(ctx.inventory)}};
 const u={...envelope('usage'),account:{url:'https://claude.ai/new',account_sha256:applicability().identity.account_sha256},
  usage:{url:'https://claude.ai/new#settings/usage',subscription_type:'pro',extra_usage_enabled:false,session_used_percent:0,weekly_used_percent:4}};
 const a={version:1,authority:'user',identity_sha256,source_references:[{author:'user',thread_id:'synthetic-thread',message_ref:'synthetic-message',quote:'synthetic permission'}],scope:authorizationScope(ctx)};
 return {...ctx,p,u,a,policy:{observation:provenance('policy'),checked_at,remote_applicability:applicability()},
  usage:{observation:provenance('usage'),checked_at,browser_account_sha256:applicability().identity.account_sha256}};
};
// Rehash mutations so tests exercise meaning checks, not just hash mismatches.
function check(f){const policyEvidence=JSON.stringify(f.p),usageEvidence=JSON.stringify(f.u);return verifyObservationBundle({...f,
 policy:{...f.policy,evidence_sha256:hash(policyEvidence)},usage:{...f.usage,evidence_sha256:hash(usageEvidence)},
 policyEvidence,usageEvidence,userAuthorization:JSON.stringify(f.a)});}
test('ツールによる観測とユーザーによる許可を分離し、本人レビューを偽装しない',()=>{
 const f=fixture();assert.deepEqual(check(f),{user_authorization_sha256:hash(JSON.stringify(f.a)),observation_verified:true,quality_approved:false});
 for(const mutate of [x=>x.policy.reviewed_by='human',x=>x.usage.reviewed_by='human',x=>x.policy.observation.observer='user',
  x=>x.policy.observation.methods=[],x=>x.usage.observation.kind='self_approved',x=>x.a.authority='assistant',
  x=>x.a.source_references=[],x=>delete x.a.source_references,x=>delete x.a.source_references[0].quote,
  x=>x.a.source_references[0].message_ref='',x=>x.a.source_references[0].author='assistant',x=>x.a.source_references[0].thread_id='']){
  const f=fixture();mutate(f);assert.throws(()=>check(f));
 }
});
test('同じhashへ結び直した別範囲・別identity・古い/欠損証拠・未知課金も拒否',()=>{
 for(const mutate of [x=>x.a.scope.mode='delegated',x=>x.a.scope.packet_sha256=hash('other'),x=>x.a.scope.additional_charges_allowed=true,
  x=>x.a.scope.production_changes_allowed=true,x=>x.a.scope.plugin_ids.push('other'),x=>x.a.scope.quality_approval_allowed=true,
  x=>x.a.identity_sha256=hash('other'),x=>x.p.identity_sha256=hash('other'),x=>x.u.identity_sha256=hash('other'),
  x=>x.p.checked_at='2000-01-01',x=>x.u.checked_at='2000-01-01',x=>x.p.observer='human',x=>delete x.p.cli,
  x=>x.p.cli.remote_cache='present',x=>x.p.endpoint.mdm_enrolled=true,x=>x.p.endpoint.dep_enrolled=true,
  x=>x.p.endpoint.inventory_sha256=hash([]),x=>delete x.u.account,x=>delete x.u.usage.session_used_percent,
  x=>x.u.usage.session_used_percent=100,x=>x.u.usage.weekly_used_percent='4',x=>x.u.usage.weekly_used_percent=-1,
  x=>x.u.usage.extra_usage_enabled=true,x=>x.u.account.account_sha256=hash('other'),
  x=>x.u.account.url='https://other.example/account',x=>x.u.usage.url='https://other.example/usage']){
  const f=fixture();mutate(f);assert.throws(()=>check(f));
 }
});
test('元証拠のない根拠なしboolean・空文字・hashの不一致は拒否',()=>{
 const f=fixture();
 assert.throws(()=>verifyObservationBundle({...f,policyEvidence:'',usageEvidence:'',userAuthorization:'true'}));
 assert.throws(()=>verifyObservationBundle({...f,policyEvidence:JSON.stringify(f.p),usageEvidence:JSON.stringify(f.u),userAuthorization:JSON.stringify(f.a)}));
});
