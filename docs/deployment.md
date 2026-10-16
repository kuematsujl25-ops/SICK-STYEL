# 月額0円の公開構成

2026-10-16確認。Cloudflare Workers Free + D1、Cloudflare標準の `workers.dev` URLを使用します。Vercel Pro、Paid Workers、有料トライアル、Neon有料プラン、独自ドメインは契約しません。

## 比較と選択

| 構成 | 適合性 | 0円運用と停止 | 判断 |
| --- | --- | --- | --- |
| Workers + D1 Free | SQLiteのSQL・既存認証・Node HTTP互換APIを再利用。DBの別認可不要 | WorkersとD1の無料上限で拒否。Paidにしない | 採用 |
| Workers + Neon Free | 既存Neonドライバーを再利用可能。別のDBアカウントと接続文字列が必要 | CU時間・容量・転送量の別管理が必要。Freeを維持 | 既存Neonが未作成のため不採用 |
| Pages Functions + D1 | 同じWorkers無料枠。ファイルルーティングとCron用Workerを追加する必要 | 無料上限で停止 | 変更点が多いため不採用 |

Cloudflareのセルフサービス規約は法人による契約も対象とし、今回確認した規約にHobbyのような非商用限定条件はありません。ブランド管理に利用できる構成と判断しています。決済やカード情報の収集機能は含みません。

## 無料枠と停止

- Workers: アカウント合計100,000動的リクエスト/日。超過時は1027で拒否。静的アセット配信は無料・無制限。
- CPU: HTTP/Cronとも1回10ms。超過処理は1102で停止。ネットワーク待機はCPU時間に含まれません。重いデータ処理で停止する場合は最適化し、有料へ自動変更しません。
- メモリー128MB、外部サブリクエスト50/回。Instagramは最大25メディアの範囲に制限。
- D1: 読取500万行/日・書込10万行/日（アカウント全体）、合計5GB、1DB最大500MB、最大10DB。
- D1の日次上限でクエリーが失敗し、次の00:00 UTC（日本時間09:00）にリセット。保存済みデータは残ります。容量上限では新しい書込が失敗します。バックアップ取得も読取上限の影響を受けます。
- D1の1行は最大2MB。本アプリの業務データは1ドキュメントなので、DB全体が500MB未満でも1行の上限が先に来ます。大量データは分割設計が必要です。
- D1 Time TravelはFreeで7日。別途、管理画面からJSONバックアップを保管してください。
- 上限停止中はログイン・保存・Instagram同期・Webhookにも影響します。WebhookはMetaの再送期間を超えると欠落し得るため、対応待ちDMは観測範囲と開始時刻を表示します。
- `MAINTENANCE_MODE=true`でAPIを503停止する機能もあります。静的ログイン画面だけ残り、業務データは公開しません。

自動課金を防ぐ前提は**対象アカウントのWorkersをFreeのまま維持すること**です。予算通知だけを「課金停止」とは扱いません。デプロイラッパーはFreeの確認記録がない・有効期限切れ・対象アカウント不一致なら拒否し、支払いAPIやプラン変更APIを呼びません。後から所有者が手動でPaidへ変えた場合はこの0円条件が成立しなくなるため、変更しないでください。

## 本人が必要な操作

```sh
npx wrangler login
```

Cloudflareアカウントへログインして公式OAuthを許可します。未登録ならFreeアカウントを作り、カード登録・Paid Workers・トライアルは選びません。トークンをチャットに貼る必要はありません。

ログイン後、Cloudflare Dashboard → Workers & Pages → プランで**Free**と確認します。複数アカウントがある場合はFreeの対象を指定します。その後のDB作成・バインド・移行・Secrets登録・公開・検証はエージェントが進められます。

## 認可後の実行手順

1. `npx wrangler whoami --json` で対象アカウントIDを確認し、`wrangler.jsonc`の`account_id`へ設定。
2. ダッシュボードでFreeを確認し、Git対象外の `.cloudflare-free.json` に `{ "accountId": "実ID", "plan": "free", "checkedAt": "ISO日時", "source": "https://dash.cloudflare.com/...確認した画面" }` を記録。記録は24時間有効。
3. `npx wrangler d1 list --json` で二重作成を避け、未作成なら `npx wrangler d1 create sickstyle-db --location apac`。返されたDB IDを`wrangler.jsonc`のDBバインディングへ設定。
4. `npx wrangler d1 migrations apply sickstyle-db --remote` でスキーマを作成。
5. `npm run migrate:export:d1` で元SQLiteの整合性付きバックアップと非公開SQLを作成。元DBは変更しません。現時点の検査は管理者0件・業務データ0件です。移行対象があれば、移行先に管理者・workspaceがないことを確認して `npx wrangler d1 execute sickstyle-db --remote --file .migration/legacy.sql`、照合。既存データは上書きしません。セッションは移行しません。
6. `npm run setup:local` → `npm test` → `npm run build`。`npm test`はWorkersバンドルを生成し、実行環境＋D1のエミュレーター検証を含みます。
7. `npm run deploy`。Wrangler設定、Free確認、実DB、標準URLのみであることを確認して公開し、`.env.bootstrap`の秘密値をSecretsへ登録。値はログに出しません。
8. 実際に返されたworkers.dev URLを`APP_ORIGIN`としてWorker設定へ追加して再デプロイ。URLを推測しません。
9. 管理者が初期登録。ローカルでは`npm run admin:create`、公開版では本人端末に保管した初期設定キーを使います。初期設定キーは`.env.bootstrap`に非公開で保管されています。チャット・ログに表示しません。
10. `npm run verify:deployment`（BASE_URL / VERIFY_EMAIL / VERIFY_PASSWORDは本人端末の環境変数へ安全に設定）またはブラウザーで、独立セッション共有・ログアウト後の401・DB保存を検証。秘密値をコマンド引数に渡さないでください。

## 公式資料

- [Cloudflareセルフサービス規約](https://www.cloudflare.com/terms/)
- [Developer Platform固有条件](https://www.cloudflare.com/service-specific-terms-developer-platform/)
- [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers上限](https://developers.cloudflare.com/workers/platform/limits/)
- [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1上限](https://developers.cloudflare.com/d1/platform/limits/)
- [D1上限到達時](https://developers.cloudflare.com/d1/reference/faq/)
- [Neon Freeの現行条件](https://neon.com/docs/introduction/plans)
