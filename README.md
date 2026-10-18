# SICKSTYLE 管理アプリ

日本語・スマートフォン対応の、単一管理者用ブランド業務管理アプリです。公開先はCloudflare Workers Free + D1です。標準のworkers.dev URLを使い、有料プラン・トライアル・自動課金を利用しません。公開版はローカルファイルへ保存しません。

## 開発・テスト

Node.js 24を使用してください。

```sh
npm ci
npm test
npm run build
```

ローカルで使う場合:

```sh
npm run setup:local
npm run admin:create   # 対話式。メール・パスワード（このアプリ専用）を入力。キー入力は不要
npm start              # http://127.0.0.1:3000
```

公開（スマホ・別PCから利用）する場合は `npm run cloud:setup` の1コマンドです。詳細は [公開手順と無料枠](docs/deployment.md)、管理者作成・「初期設定キー」の意味は [管理者作成手順](docs/local-admin.md) を参照してください。

## AI社員と既存本番の更新

9担当への依頼、BASE/TikTok/Metricoolの根拠CSV、Claude Code/Codex CLIによる手動分析、本人レビューを利用できます。[AI社員・開発レビュー・コード専用デプロイ手順](docs/ai-team-runtime.md)を参照してください。既存本番への更新は`npm run deploy:existing -- --apply`を使い、既存Secrets・VariablesとDBスキーマを保持します。

## 機能

- 最終／月間目標と達成率
- タスク・期限・優先度・完了管理
- 発送リスト・発送期限・配送会社・追跡番号・状況
- Amazon売上・注文、Instagram指標の手入力とCSV取込（Amazon）
- 理念・起源・Mission・Vision・Values
- ログイン、端末間で共通のDB保存、JSONバックアップ・復元
- ホーム画面への追加（Web App Manifest / Service Worker）
- Instagram Loginの接続・解除、サーバー側トークン暗号化・更新、公式Insights同期、対応待ちDMの推定（Conversations API）とWebhook観測
- Amazon SP-API（Amazon.co.jp）のLWA認可、Sales APIの日別売上・Orders APIの配送状況の同期（[手順](docs/amazon-setup.md)）

手入力実績とInstagram公式取得値は分離しています。公式データはInstagram連携画面に表示します。取得できない指標は「未取得」、実際に取得した0は0で表示します。

## 無料公開・外部連携

[公開手順と無料枠・停止条件](docs/deployment.md) に比較と選択理由を記載しています。Cloudflareへの本人ログイン後、D1作成・Secrets登録・標準URLへの公開を進めます。

- `wrangler.jsonc`: Worker・D1バインディング・静的アセット・毎日09:00 JSTの同期
- `npm run deploy`: Freeプランと対象アカウントの確認、実DB、標準URLのみであることを確認して公開。確認記録がなければ停止
- `MAINTENANCE_MODE=true`: APIを503停止
- `npm run migrate:export:d1`: 元SQLiteのバックアップと、上書きしない移行SQLを非公開ファイルへ出力

Workers FreeとD1の上限に達すると動的操作が停止し、課金プランへ切り替えません。主な上限は100,000リクエスト/日、CPU10ms/回、D1読取500万行/日・書込10万行/日・1DB500MBです。アカウント全体の利用状況にも影響されます。定期的にJSONバックアップを取得してください。

Instagram設定は [本人認可・Webhook手順](docs/instagram-setup.md) を参照してください。SecretsはCloudflare側に保管し、ブラウザーやGitへ含めません。Instagram・Amazonとも未認可でも業務データは手入力（AmazonはCSVも可）で利用できます。


## 共有と競合

同じ管理者アカウントをスマートフォンや他端末から利用します。画面右上の↻で最新データを読み込めます。保存ごとに更新番号を確認し、古い端末から新しい変更を上書きすることを409で防止します。リアルタイム共同編集・複数ユーザー管理は対象外です。

## バックアップ・移行

設定画面からJSONをダウンロードできます。JSONには業務データのみを含み、パスワード・セッション・Instagramトークン・DMイベントは含みません。復元前の業務データを外部DBの`before-restore`へ1世代保存します。定期的にJSONも安全な場所へ保管してください。D1 FreeのTime Travelは7日です。

既存SQLiteを検査するには `npm run migrate:check`、D1への移行SQLを作るには `npm run migrate:export:d1` を使います。移行は整合性付きバックアップ・照合を行い、移行先に管理者または業務データがある場合は上書きせず停止します。セッションは移行せず再ログインが必要です。

## セキュリティと運用

- パスワードはsalt付きPBKDF2-SHA256（10万回、旧scrypt形式も検証可）。セッションはDB保存、24時間有効。
- CookieはHttpOnly・SameSite=Lax。Cloudflare本番ではSecure強制。OAuthからの復帰を可能にし、書き込みにはOrigin / Fetch Metadataの確認を追加。
- ログイン回数制限は外部DBで管理し、サーバーレスの複数インスタンス間で共有。
- 業務API・バックアップ・Instagram取得APIはログイン必須。
- Instagram認可は短期・一度限りのstateをログインセッションに固定。
- アクセストークンはAES-256-GCMで暗号化して外部DBへ保存。ブラウザー・業務バックアップ・通常ログへ出力しない。
- WebhookはMeta App SecretでHMAC-SHA256を検証し、イベントIDで重複排除。本文や添付URLは保存せず、集計に必要な会話ID・メッセージID・時刻だけ保存。
- Service Workerは業務データをキャッシュしない。オフラインで業務操作は不可。
- パスワードリセットメールは未実装。管理者資格情報を安全に保管。

検証範囲と未実施項目は [検証記録](docs/verification.md) を参照してください。
