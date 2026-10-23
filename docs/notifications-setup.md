# SICKSTYLE 通知（Web Push + 管理アプリ履歴）— 本番導入手順

## 機能
- 毎日 **9:00 JST**：Googleの当日予定（本人認可済みの場合）、SICKSTYLEの担当タスク、団体営業のZoom予定の件数と一覧。
- 毎日 **20:00 JST**：Amazonの当日売上（APIまたは手入力/CSVの出典付き、速報値）。
- 毎日 **22:00 JST**：前日比による売上の基礎分析。売上・前日データが欠ければ「分析不可」。変動原因は自動で確定しない。
- AI社員の成果物JSONが取り込まれ「人間レビュー待ち」になったときと、担当者が承認して「完了」になったときに通知。
- SICKSTYLEの「設定・バックアップ → 通知センター」に、通知履歴と端末の通知ON/OFFを表示。既存D1 `ss_documents` を使用し、業務データを上書きしない。

## 前提
- Web Pushは本人の操作で通知許可・端末登録をした場合のみ配信。サーバーの配信鍵未登録なら通知履歴だけ保存し、プッシュ通知は配信しない。
- iPhoneは **Safariからホーム画面に追加**したWebアプリ（iOS 16.4以降）から通知許可する。普通のSafariタブ内ではなくホーム画面のSICKSTYLEアイコンから開く。Chrome/デスクトップもブラウザーの通知設定による。
- 通知時刻はCloudflareのCronの実行に依存し、端末の省電力、オフライン、配信事業者の遅延により厳密な秒単位の到着を保証しない。
- Amazon Ads APIは未接続。広告経由の売上・広告費は手入力・CSVのみ、未取得の数字を推定しない。
- Googleカレンダー本人認可がない場合は「未接続」と通知。接続できていても50件を超える予定はすべて表示しない（先頭50件に制限）。
- AI社員ランナーがMacで停止している間は分析完了イベントも発生せず、完了通知は配信されない。
- D1のプッシュ購読情報（配信先・暗号化鍵）は既存 `TOKEN_ENCRYPTION_KEY` で暗号化して保存。秘密キーはCloudflare Secretに格納し、GitHub/チャットには共有しない。

## Step 1: リポジトリのCI・本番復元検証
- 最新統合SHAの `npm test` とGitHub CIを確認。
- Codex独立レビューは未実施の事実を保持し、本人が保留を再承認する場合は従来の明示記録を使用。
- 本番Workerは `sickstyle-manager`、D1は `sickstyle-db`。現在のSecrets、定期実行、ログイン・D1データを変更せず事前にバックアップを取る。
- 既存の `npm run deploy:preflight` → `npm run deploy -- --apply` はコード専用Version。**Cronの新規追加はこの手順では自動反映されません。**

## Step 2: VAPID鍵を本人のMacで生成・登録
安全な端末上で一度だけ:
```bash
node scripts/generate-vapid.js
```
`.wrangler/vapid-credentials.json` が作成される。これは .gitignore 済みの秘密ファイルなので、クラウド・チャット・GitHubへアップロードしない。

本人がCloudflare Workersの本番Secret設定を変更することを承認した場合に限り、`sickstyle-manager` の次の3件を登録する。
- `VAPID_PUBLIC_KEY`：JSONの同名値
- `VAPID_PRIVATE_KEY`：JSONの同名値（秘密）
- `VAPID_SUBJECT`：JSONの同名値（公開URL、https）

CLIの場合は `npx wrangler secret put VAPID_PUBLIC_KEY --name sickstyle-manager` などを1件ずつ利用し、値は対話入力する。**秘密キーをシェルコマンドの引数に直書きしない。**
設定するとCloudflare WorkerのVersionが新しくなる可能性があるため、作業前後のVersion・トラフィックを必ず確認する。Free枠・料金条件も本人が確認する。

## Step 3: Cron Triggersの追加
CloudflareのCronは**UTC**。
既存の `0 0 * * *` と `10 0 * * *` は絶対に消さず、ダッシュボードの Worker → Settings → Triggers に次の2件を**追加**する。
- `0 11 * * *` = 20:00 JST（Amazon同期後の売上速報）
- `0 13 * * *` = 22:00 JST（Amazon同期後の分析）

9:00 JSTは既存の `0 0 * * *` を共有し、Instagram同期と今日の予定通知を実行する。新Cronが追加されない限り、20時/22時の通知は実行されない。
`wrangler.jsonc`にも4件すべてを宣言しており、コードと設定が一致することを確認する。Cloudflareの伝播には遅延があり得る。

## Step 4: 端末の通知ON
1. SICKSTYLE管理アプリでログイン →「設定・バックアップ → 通知センター」。
2. iPhoneの場合はホーム画面へ追加し、そのアイコンから起動する。
3. 「この端末で通知を有効にする」を本人がタップし、端末の通知許可を選択。
4. 通知履歴と端末数を確認。必要ない端末は「この端末への通知を停止」。

## Step 5: 本番の実動作検証
- 実際のプッシュ通知が端末に届くか、まず本人が許可した端末で確認。
- Google予定の件数をGoogleカレンダーで、Amazon売上速報をSeller Centralと照合する（値の定義・時点を揃える）。
- AI社員のテスト依頼1件を実行し、成果物取込で「人間レビュー待ち」、承認後に「完了」が通知されることを検証。
- Zoom OAuthは別原因が残っている可能性がある。今回の変更では失敗時のsafeなコードとstageを画面に表示するため、両者を元に根本原因を再調査する。認証情報の再作成を繰り返さない。
- 端末への配信失敗は `push_rejected` / `push_failed`、定期処理失敗は `scheduled_notification_failed` のログを検索。ログに実際のTokenや購読エンドポイントを出さない。

## 未完了・拡張候補
- 22時の分析は前日比・欠損判定のみのMVP。広告ROAS・在庫欠品・7日移動平均等の多変量解析は今後の段階。
- 予定の招待メール・Zoom会議作成は既存の本人OAuth連携が完了するまで自動化できない。
- Web Pushの端末実機・APNs/FCMへのE2E配信確認は本番の本人端末/認証情報が必要で、GitHub CIは模擬テストのみ。
