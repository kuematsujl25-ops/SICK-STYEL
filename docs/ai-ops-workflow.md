# AI開発フロー（ChatGPT / Claude Code / Codex / GitHub / Cloudflare Workers）

## 全体像

```
① ChatGPT（AI秘書室）
   → GitHub Issueでタスク登録・進捗監視・改善提案

② GitHub Issue に "claude" ラベルを付与
   → .github/workflows/claude.yml が起動
   → Claude Code（anthropics/claude-code-action）が実装し、
     ブランチ claude/... を作成してPRを作成

③ PR作成
   → .github/workflows/ci.yml が npm test（wrangler --dry-run + node --test）を実行
   → .github/workflows/codex-review.yml が Codex によるレビューを実行し、
     PRにレビューコメントを投稿

④ 人間（リポジトリ管理者）
   → CI結果とCodexレビューを確認し、必要なら @claude で追加修正を依頼
   → 問題なければ人間がマージを承認
   → 本番デプロイ（npm run deploy）は人間が手動実行
```

**この自動化はPR作成とレビューまでです。マージと本番デプロイ（Cloudflare Workers）は意図的に自動化していません。**

## 本番環境（変更しない）

- Cloudflare Workers: `https://sickstyle-manager.sickstyle-74h4.workers.dev`
- デプロイ手順: `npm run deploy`（`npm test` → `scripts/cloudflare-deploy.js`、人間が手動実行）
- Vercelプロジェクト（`sickstyle-manager`）は廃止済み（`scripts/provision-secrets.js`参照）。本番とは無関係
- GitHub Actionsから`wrangler deploy`（本番反映）を実行する設定は含めていない。CIで実行する`wrangler deploy --dry-run`はビルド検証のみで、Cloudflareへの実デプロイは発生しない

## 必要な設定（未設定・要承認）

| 項目 | 状態 | 内容 |
|---|---|---|
| `ANTHROPIC_API_KEY`（GitHub Secret） | **未設定** | Claude Code Action用 |
| `OPENAI_API_KEY`（GitHub Secret） | **未設定** | Codexレビュー用 |
| GitHubへの初回push | **未実施** | リポジトリが現在空のため、まずローカルの7コミットをpushする必要がある |
| ワークフローのpush | **未push** | `.github/workflows/*.yml` はローカル作成のみ |
| GitHub Issueのラベル`claude`の作成 | **未作成** | Issueに付与して実装を起動するため |

## 動作確認済み（ローカル）

- `npm test`（wrangler dry-run build検証 + node --test、15件）✅ ネットワーク接続・Cloudflare認証なしで成功

これにより `.github/workflows/ci.yml` は現状のコードベースで成功することを確認済みです。
