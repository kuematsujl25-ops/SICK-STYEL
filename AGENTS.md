# 開発・テスト・レビューのルール（Claude Code実装 / Codexレビュー運用）

## プロジェクト概要

- 実行環境：**Cloudflare Workers + D1**（Vercelは廃止済み。`scripts/provision-secrets.js`参照）
- 本番URL：`https://sickstyle-manager.sickstyle-74h4.workers.dev`
- デプロイは `npm run deploy`（`npm test` → `scripts/cloudflare-deploy.js`）を人間が手動実行する。**GitHub Actionsから本番デプロイは行わない。**

## 役割分担

- **Claude Code**：GitHub Issueを受けて実装・自己テスト・PR作成を行う。
- **Codex**（`openai/codex-action`、PR作成時に自動起動）：実装内容をレビューし、改善点・バグ候補をPRコメントで指摘する。
- **GitHub Actions**（`.github/workflows/ci.yml`）：`npm test`（内部で`wrangler deploy --dry-run`によるビルド検証 + `node --test`）を実行し、失敗時はログの末尾をPRコメントで報告する。
- 人間（リポジトリ管理者）：最終的なマージ承認と本番デプロイ（`npm run deploy`の実行）を行う。

## 実装時に必ず守ること

1. `.env`・`.dev.vars`・`.wrangler/`・`data/`配下（D1のローカルデータ）をコミットしない（`.gitignore`で保護済み）。
2. Amazon SP-API／Instagram／Cloudflare Secretsなどの秘密値は `scripts/set-secrets.js` を通じて Cloudflare Secrets に登録し、コード・ログ・コミットに平文で残さない。
3. 実装後は必ずローカルで `npm test` を実行し、通過を確認してからコミットする。
4. 顧客（商品・お知らせ掲載、Instagram/Amazon連携）の実データをテストコードやドキュメントに記載しない。テストは既存の慣例（`example.com`等のダミー値）に従う。
5. 作業ブランチで変更し、`main`への直接pushは行わない。実装が完了したらPRを作成し、CIとCodexレビューの結果を待つ。
6. `wrangler.jsonc`の`account_id`・`database_id`はリソース識別子であり認証情報ではないため既存のまま変更不要（削除・匿名化しない）。

## Codexレビューで重点的に見てほしい点

- 管理者作成・パスワード処理・セッション管理（`lib/password.js`、`scripts/create-admin*.js`）のセキュリティ
- Amazon/Instagram連携（`integrations/*.js`）のトークン取り扱い・リトライ/失敗時挙動
- D1への書き込みがパラメータ化クエリーになっているか（SQLインジェクション対策）
- 公開APIが管理用項目を漏らしていないか（`api/index.js`の公開/非公開の切り分け）
