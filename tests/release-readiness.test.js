import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {reviewForHead,reviewForHeadOrWaiver,recordReviewWaiver,verifyReviewWaiverRecord,productionVersions,verifySqlBackup,checkReadiness,fileHash} from '../scripts/lib/release-readiness.js';

test('本番Version配分を検証し、不明なVersionや壊れた配分を拒否',()=>{
  const version_id=randomUUID();assert.deepEqual(productionVersions({versions:[{version_id,percentage:100}]}),[{version_id,percentage:100}]);
  for(const versions of [[],[{version_id:'bad',percentage:100}],[{version_id,percentage:80}],
    [{version_id,percentage:50},{version_id,percentage:50}],[{version_id,percentage:NaN}]])
    assert.throws(()=>productionVersions({versions}));
});

test('最新SHA・レビュー・バックアップのローカル復元が揃い、期限内の場合だけ事前確認を受理',()=>{
  const root=mkdtempSync(join(tmpdir(),'ss-readiness-'));
  try{
    mkdirSync(join(root,'data/code-reviews'),{recursive:true});
    const head='a'.repeat(40),file='data/code-reviews/'+head+'-fixture.json';
    const report={head,base:'b'.repeat(40),provider:'codex',status:'human_assessment_required',finished_at:new Date().toISOString(),report:'No findings.'};
    writeFileSync(join(root,file),JSON.stringify(report));
    const sql='data/backup.sql';
    writeFileSync(join(root,sql),readFileSync('migrations/0001_initial.sql','utf8')+"\nINSERT INTO ss_users(id,email,hash,salt) VALUES (1,'fixture@example.com','fixture-hash','fixture-salt');\n");
    const backup={file:sql,...verifySqlBackup(join(root,sql))};
    const config={name:'sickstyle-manager',account_id:'fixture-account',d1_databases:[{database_id:'fixture-db'}]};
    const receipt={version:1,head,worker:config.name,account_id:config.account_id,database_id:'fixture-db',checked_at:new Date().toISOString(),
      previous_versions:[{version_id:randomUUID(),percentage:100}],free_and_zero_cost_confirmed:true,
      settings_preservation_confirmed:true,rollback_compatibility_confirmed:true,review_confirmed:true,validation_confirmed:true,
      review:reviewForHead(root,head,report.base),backup};
    assert.doesNotThrow(()=>checkReadiness(root,head,config,receipt,report.base));
    for(const patch of [{head:'c'.repeat(40)},{checked_at:'2020-01-01T00:00:00Z'},
      {free_and_zero_cost_confirmed:false},{settings_preservation_confirmed:false},{review_confirmed:false},
      {rollback_compatibility_confirmed:false},{validation_confirmed:false},{backup:{...backup,sha256:'bad'}}])
      assert.throws(()=>checkReadiness(root,head,config,{...receipt,...patch},report.base));
    assert.throws(()=>reviewForHead(root,head,head),/最新SHA/);
    assert.throws(()=>reviewForHead(root,head,'c'.repeat(40)),/最新SHA/);
    writeFileSync(join(root,file),JSON.stringify({...report,report:'[P2] unresolved finding'}));
    assert.throws(()=>reviewForHead(root,head,report.base),/P0\/P1\/P2/);
    assert.throws(()=>checkReadiness(root,head,config,receipt,report.base));
    writeFileSync(join(root,file),JSON.stringify({...report,head:'c'.repeat(40)}));
    assert.throws(()=>reviewForHead(root,head,report.base),/最新SHA/);
    writeFileSync(join(root,sql),'this is not a backup');
    assert.throws(()=>verifySqlBackup(join(root,sql)),/復元/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('Codexレビューがない場合に限り、理由付きで明示的に保留できる（偽装・隠蔽はしない）',()=>{
  const root=mkdtempSync(join(tmpdir(),'ss-waiver-'));
  try{
    const head='d'.repeat(40),base='e'.repeat(40);
    assert.throws(()=>recordReviewWaiver(root,head,base,''),/理由/);
    assert.throws(()=>recordReviewWaiver(root,head,base,'   '),/理由/);
    assert.throws(()=>recordReviewWaiver(root,head,head,'reason'),/SHA/);
    const waiver=recordReviewWaiver(root,head,base,'Codex使用上限のため一時保留（本人承認済み）');
    assert.equal(waiver.waived,true);
    assert.equal(waiver.base,base);
    const saved=JSON.parse(readFileSync(join(root,waiver.file),'utf8'));
    assert.equal(saved.provider,'none');
    assert.equal(saved.status,'review_waived');
    assert.equal(saved.head,head);
    // 保留記録はreviewForHead()の「本物のCodexレビュー」フィルタには一致しない（取り違え防止）。
    assert.throws(()=>reviewForHead(root,head,base),/最新SHA/);
    // waiverReason未指定なら、通常のreviewForHead()と全く同じ挙動（勝手に保留しない）。
    assert.throws(()=>reviewForHeadOrWaiver(root,head,base),/最新SHA/);
    const viaOr=reviewForHeadOrWaiver(root,head,base,'別の理由');
    assert.equal(viaOr.waived,true);
    assert.doesNotThrow(()=>verifyReviewWaiverRecord(root,head,base,viaOr));
    assert.throws(()=>verifyReviewWaiverRecord(root,head,base,{...viaOr,sha256:'bad'}),/変更/);
    assert.throws(()=>verifyReviewWaiverRecord(root,'f'.repeat(40),base,viaOr),/不正/);
    // 本物のレビューが存在し、かつP0/P1/P2未解決の場合は保留できず必ず停止する。
    mkdirSync(join(root,'data/code-reviews'),{recursive:true});
    const realFile='data/code-reviews/'+head+'-real.json';
    writeFileSync(join(root,realFile),JSON.stringify({head,base,provider:'codex',status:'human_assessment_required',
      finished_at:new Date().toISOString(),report:'[P1] 未解決の指摘'}));
    assert.throws(()=>reviewForHeadOrWaiver(root,head,base,'理由があっても保留できない'),/P0\/P1\/P2/);
    // 有効な本物のレビューが存在する場合は、waiverReasonを指定してもそちらが優先される。
    writeFileSync(join(root,realFile),JSON.stringify({head,base,provider:'codex',status:'human_assessment_required',
      finished_at:new Date().toISOString(),report:'No findings.'}));
    const preferred=reviewForHeadOrWaiver(root,head,base,'本物があるので無視されるはず');
    assert.equal(preferred.waived,false);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('checkReadinessは保留記録ありの事前確認も受理するが、他の安全確認は省略しない',()=>{
  const root=mkdtempSync(join(tmpdir(),'ss-readiness-waived-'));
  try{
    const head='a'.repeat(40),base='b'.repeat(40);
    const review=recordReviewWaiver(root,head,base,'Codex使用上限のため一時保留（本人承認済み）');
    const sql='data/backup.sql';
    writeFileSync(join(root,sql),readFileSync('migrations/0001_initial.sql','utf8')+"\nINSERT INTO ss_users(id,email,hash,salt) VALUES (1,'fixture@example.com','fixture-hash','fixture-salt');\n");
    const backup={file:sql,...verifySqlBackup(join(root,sql))};
    const config={name:'sickstyle-manager',account_id:'fixture-account',d1_databases:[{database_id:'fixture-db'}]};
    const receipt={version:1,head,worker:config.name,account_id:config.account_id,database_id:'fixture-db',checked_at:new Date().toISOString(),
      previous_versions:[{version_id:randomUUID(),percentage:100}],free_and_zero_cost_confirmed:true,
      settings_preservation_confirmed:true,rollback_compatibility_confirmed:true,review_confirmed:true,validation_confirmed:true,
      review,backup};
    assert.doesNotThrow(()=>checkReadiness(root,head,config,receipt,base));
    // バックアップの改ざん・不足など、保留と無関係な安全確認は従来どおり効いている。
    assert.throws(()=>checkReadiness(root,head,config,{...receipt,backup:{...backup,sha256:'bad'}},base));
    assert.throws(()=>checkReadiness(root,head,config,{...receipt,free_and_zero_cost_confirmed:false},base));
    // 保留記録そのものが改ざん・不一致の場合は拒否される。
    assert.throws(()=>checkReadiness(root,head,config,{...receipt,review:{...review,sha256:'bad'}},base));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('npm deployは旧プロビジョニングを実行せず、既定は計画だけ',()=>{
  const pkg=JSON.parse(readFileSync('package.json'));
  assert.equal(pkg.scripts.deploy,'node scripts/deploy-existing.js');
  const result=spawnSync(process.execPath,['scripts/deploy-existing.js'],{encoding:'utf8'});
  assert.equal(result.status,0);assert.match(result.stdout,/確認のみ/);assert.match(result.stdout,/deploy:preflight/);
});
