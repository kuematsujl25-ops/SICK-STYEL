// 本番反映を許可する統合ブランチ名は scripts/deploy-existing.js の DEPLOY_BRANCH/REVIEW_BASE_BRANCH に
// 一本化されている（ここでは git ls-remote の出力を解釈するだけで、ブランチ名そのものは持たない）。
// `git ls-remote --heads origin <branch>` の出力からtip SHAを取り出す。ブランチが削除・改名されて
// リモートに存在しない場合、呼び出し側は「HEADがtipと不一致（fetch/pull不足）」と同じ扱いにしてしまうと
// 「fetch/pullすれば直る」と誤読される（実際にはブランチ名の更新と通常のレビュー・マージが必要）。
// ここで区別できる専用のエラーを投げる（Codex独立レビュー指摘）。
export function remoteBranchTipFromLsRemote(branch, lsRemoteOutput) {
  const line = (lsRemoteOutput || '').trim();
  if (!line) throw Error(`反映対象ブランチ(${branch})がリモートに見つかりません。削除・改名された場合は、scripts/deploy-existing.jsのDEPLOY_BRANCH/REVIEW_BASE_BRANCH定数を新しいブランチ名に更新し、通常のPR・独立レビュー・CIを通してから反映してください（安全確認を回避する一時的な変更・実行時の差し替えは行わないこと）`);
  return line.split(/\s/)[0];
}
