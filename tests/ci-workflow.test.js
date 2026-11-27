import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const yml=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
const deployJs=readFileSync(new URL('../scripts/deploy-existing.js',import.meta.url),'utf8');

test('CIは本番反映用の統合ブランチ(ai-staff/phase4-runtime)宛のPR・pushでも、作成元ブランチ名(claude/**以外)に関わらず必ず実行される（Codex独立レビュー指摘の回帰：統合ブランチ宛PRがCI対象から漏れていた）',()=>{
  const prTrigger=yml.match(/pull_request:\n([\s\S]*?)\n  push:/)?.[1]||'';
  assert.match(prTrigger,/branches:\s*\[[^\]]*ai-staff\/phase4-runtime[^\]]*\]/,'pull_requestトリガーに統合ブランチが含まれる');
  const pushTrigger=yml.match(/push:\n([\s\S]*?)(?:\n\npermissions:|\nonpermissions:)/)?.[1]||yml.match(/push:\n(.*)/)?.[1]||'';
  assert.match(yml,/push:\s*\n\s*branches:\s*\[[^\]]*ai-staff\/phase4-runtime[^\]]*\]/,'pushトリガーにも統合ブランチが含まれる（マージでできる実際のコミットSHAも自動テストされる）');
});

test('CIワークフローの統合ブランチ名はdeploy-existing.jsのDEPLOY_BRANCH定数と一致している（将来ブランチ名を変更する際、片方だけ更新する不整合を防ぐ）',()=>{
  const deployBranch=deployJs.match(/const DEPLOY_BRANCH='([^']+)';/)?.[1];
  assert.ok(deployBranch,'DEPLOY_BRANCH定数が見つかる');
  assert.match(yml,new RegExp(deployBranch.replace(/[/]/g,'\\/')),'ci.ymlがDEPLOY_BRANCHと同じブランチ名を参照している');
});
