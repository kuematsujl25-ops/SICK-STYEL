import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {remoteBranchTipFromLsRemote} from '../scripts/lib/deploy-branch.js';

test('ls-remoteの出力からtip SHAを取り出す',()=>{
  const sha='a'.repeat(40);
  assert.equal(remoteBranchTipFromLsRemote('ai-staff/phase4-runtime',sha+'\trefs/heads/ai-staff/phase4-runtime\n'),sha);
  assert.equal(remoteBranchTipFromLsRemote('ai-staff/phase4-runtime','  '+sha+'  refs/heads/ai-staff/phase4-runtime  '),sha);
});

test('ブランチが削除・改名されリモートに存在しない場合は、「fetch/pullすれば直る」と誤読させず、定数更新と通常レビューを促す専用のエラーにする（Codex独立レビュー指摘の回帰：P2）',()=>{
  for(const empty of ['','   ','\n'])
    assert.throws(()=>remoteBranchTipFromLsRemote('ai-staff/phase4-runtime',empty),
      /反映対象ブランチ\(ai-staff\/phase4-runtime\)がリモートに見つかりません/);
  assert.throws(()=>remoteBranchTipFromLsRemote('ai-staff/phase4-runtime',''),/DEPLOY_BRANCH\/REVIEW_BASE_BRANCH定数/);
  assert.throws(()=>remoteBranchTipFromLsRemote('ai-staff/phase4-runtime',''),/安全確認を回避する一時的な変更・実行時の差し替えは行わないこと/);
});

test('deploy-existing.jsは反映対象ブランチ名を単一の定数(DEPLOY_BRANCH/REVIEW_BASE_BRANCH)でのみ保持し、ハードコードされた文字列を複数箇所に複製しない（Codex独立レビュー指摘の回帰：ブランチ名の二重管理による不整合リスク）',()=>{
  const js=readFileSync(new URL('../scripts/deploy-existing.js',import.meta.url),'utf8');
  assert.match(js,/const DEPLOY_BRANCH='ai-staff\/phase4-runtime';/);
  assert.match(js,/const REVIEW_BASE_BRANCH='claude\/initial-github-sync';/);
  // 定数定義の行を除いて、ブランチ名の生文字列がそれ以外の場所に残っていない（すべてDEPLOY_BRANCH/REVIEW_BASE_BRANCH経由）。
  const withoutConstantDecls=js.replace(/const DEPLOY_BRANCH='ai-staff\/phase4-runtime';/,'')
    .replace(/const REVIEW_BASE_BRANCH='claude\/initial-github-sync';/,'');
  assert.doesNotMatch(withoutConstantDecls,/'ai-staff\/phase4-runtime'/);
  assert.doesNotMatch(withoutConstantDecls,/'claude\/initial-github-sync'/);
});
