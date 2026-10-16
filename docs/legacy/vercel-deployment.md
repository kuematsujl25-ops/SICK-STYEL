# Vercel公開手順

この手順のコード準備・ローカルテストは完了しています。アカウント接続・外部DB作成・実URLでの検証は実際の接続後に行います。

## 1. Vercelにログイン

このリポジトリで `vercel login` を実行し、表示された公式URLから本人がログインしてください。トークンをチャットへ送る必要はありません。ログイン後、公開対象チーム名を指定します。

SICKSTYLEの売上・発送管理は商用業務なので、非商用限定のHobbyで継続運用しないでください。既存Proチームならそこを利用し、新たな有料契約が必要な場合は所有者の確認後に行います。

## 2. プロジェクトと外部DB

Vercel Dashboard → 対象チーム → 新規プロジェクト（名前 `sickstyle-manager`、既存名があれば別名）を作成します。CLIで進める場合は対象チームを明示して `vercel link` し、`vercel project inspect --non-interactive` で公開先を確認します。

プロジェクト → Storage / Marketplace → Neon → Create Database。利用可能なFreeプランを選び、Productionに接続してください。カード入力や有料契約が必要な場合は先に確認します。Neonが要求する本人認可・利用規約同意は所有者が画面で行います。

`DATABASE_URL`がプロジェクトに設定されていることを確認します。Previewには本番DBを共用せず別ブランチ／別DBを使ってください。DBリージョンとFunctionリージョンは近い場所にします。

## 3. 環境変数

プロジェクト → Settings → Environment Variables → Production に追加します。

- `APP_ORIGIN`: Productionの正式Origin（例 `https://割り当てられた名前.vercel.app`、末尾 `/` なし）
- `SETUP_TOKEN`: 管理者が生成したランダムキー。初回登録後は削除して再デプロイできます
- `ADMIN_EMAIL`: 初回管理者のメールアドレス
- `TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` で本人端末上に生成し、その値を環境変数欄に設定。継続運用で同じ値を保持します
- `CRON_SECRET`: 別のランダムな秘密文字列（毎日09:00 JSTの同期を保護）
- `COOKIE_SECURE=true`

アプリはローカルファイルをクラウドデータの代用にしません。DBが未設定・接続失敗なら業務APIはエラーになります。DB接続を先に完了させてください。

## 4. 既存データの移行

ローカルSQLiteを保護したまま `npm run migrate:check` で件数を確認します。移行が必要ならProductionの接続を安全にローカルへ読み込み、`npm run migrate:apply`。元SQLiteは変更せず、移行前バックアップを`data/backups/`に作り、空の移行先にのみ移行して内容を照合します。

現在の移行前検査では管理者0件・業務ドキュメント0件です。実行前に再検査してください。

## 5. デプロイ

`npm ci` → `npm test` → `npm run build` を実行します。Vercel Framework PresetはOther、Output Directoryはpublic、Node.jsは24.x。リポジトリの`vercel.json`でAPIとCronを設定しています。

CLIでは `vercel deploy --prod --skip-domain` で本番ビルドをステージし、起動確認後 `vercel promote <deployment-url>` で正式ドメインへ割り当てます。環境変数を追加／変更した後は再デプロイが必要です。設定ファイルや`.env`、`data/`は外部へアップロードしません。

## 6. 所有者の初回登録と公開後検証

正式URLで初期設定キー・指定メール・パスワードを使い1名の管理者を登録します。無制限登録APIはありません。

独立した2ブラウザーまたはスマートフォンとPCで同じ管理者としてログインし、Aで登録したタスクをBで読み込み、Aのログアウト後に業務API・バックアップが401になることを検証します。

`BASE_URL`・`VERIFY_EMAIL`・`VERIFY_PASSWORD`を本人端末の環境変数に設定して `npm run verify:deployment` を実行すれば、一時タスクの追加・端末相当の独立セッション共有・アクセス拒否・一時データ削除を確認できます。パスワードは出力しません。認証情報をチャットへ貼らないでください。

最後に実際のProduction URL、外部DB保存・共有の確認結果、Instagram接続状況を報告します。公開されていないURLを完成URLとして報告しません。


## 現在の接続状態（2026-10-16）

- Vercel CLIの本人ログイン完了
- 対象: kuematsujl25-3805 / sickstyle-manager
- Project ID: prj_YjVpTp0RmJJIVblZAYVJI9CltfJx
- Node.js 24.x / Other / public + api/index.js
- Productionに TOKEN_ENCRYPTION_KEY / SETUP_TOKEN / CRON_SECRET / META_WEBHOOK_VERIFY_TOKEN をSecretとして設定済み
- 秘密値の控えはGit対象外の.env.bootstrap（所有者のみ読み取り可能）。初回登録にSETUP_TOKENを使います。値をチャットへ貼り付けないでください
- Neon FreeのプランIDはfree_v3（カード不要）と確認済み
- Neonは本人による利用規約承認待ち。DBリソース未作成、DATABASE_URL未設定
- VercelチームはHobby。商用利用のPro契約について所有者確認待ち。有料契約は未実施
- Vercel本番用ローカルビルド成功。Productionデプロイ・正式URLはまだ発行していません

Neon承認: https://vercel.com/kuematsujl25-3805/~/integrations/accept-terms/neon?source=cli

承認後、まず `vercel integration installations --integration neon --format json --scope kuematsujl25-3805` と `vercel integration list --integration neon --format json --scope kuematsujl25-3805` で状態を確認し、既存DBを二重作成しないでください。未作成なら次の設定で作成します。

```sh
vercel integration add neon --name sickstyle-db --plan free_v3 --metadata region=iad1 --metadata auth=false --metadata realtime=false --environment production --no-env-pull --no-claim --non-interactive --format json --scope kuematsujl25-3805
```

Neonの生成スキルだけが失敗した場合、DB作成を再実行しないでください。既存リソースを確認してスキルのみ修復します。
