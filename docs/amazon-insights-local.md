# Amazon閲覧機能：ローカル検証（2026-10-27）

この変更は未公開。実データ接続の追加・認可変更・発送通知・広告設定変更は実施していない。

## 接続確認

既存ログイン中の管理アプリでSP-APIの接続済み表示と10月27日9:10 JSTの最終成功を確認。Adsは未連携・実績未取得。SPPへの読み取りアクセスはログイン画面に遷移し、Adsは公開ページまでで、実際の承認ロール・登録ユースケース・Ads API承認は確認できなかった。新規ログイン、認可、資格情報参照は行っていない。未承認という意味ではなく、確認保留。

read-onlyのリモート比較ではアプリブランチ `ai-staff/phase4-runtime` は357c39db3c493f5b123b5812e02293b87bd0af38。mainは7d07fd4e7b16a9b65e12e9ac00a5a3091d8c6f8e（管理アプリなし）、リモートHEADは7355924da7e7f3ba41536ea8d191ddce73b371f6。今回の実装基点はa02250e。PR71を含む357c39dを祖先に持つ独立作業場所でのみ変更した。将来の統合前に357c39d以降の最新main/アプリ実ブランチを再照合する。

## 今回の実装

- Orders v2026の既存同期でFULFILLMENT,PACKAGESを指定。注文ID、発送元区分、発送状態、発送期限、荷物ごとの列挙型状態だけをallowlistで保存。recipient、buyer、trackingNumber、shipFromAddress、自由文は追加保存しない。RECIPIENT/BUYERは要求しない。
- 自社発送一覧は発送済みと配達完了を分離。未取得、失敗時の前回値、上限500件による一部取得、発送元不明を区別。期間は既存の作成日ベース直近31日で、31日以前の未発送注文を網羅する一覧ではない。
- Ads v3の既存レポート処理にclicks/impressionsを追加。最後に完了したレポートの期間・帰属窓を保存し、その期間の広告費/広告経由売上の合計からROAS/ACOSを計算。欠損、0分母、0行は0円/0%に補完しない。手入力とは別パネル。
- 生成中/失敗時は前回成功の時刻を維持。プロフィール変更/未設定時は旧プロフィールの実績を返さない。過去キャッシュに期間やクリックがなければ未取得を表示する。
- 認証状態をまたいだ古いAPI応答を拒否。401時は画面とAdsメモリを消去し、Ads同期のcatchから再取得しない。
- 住所と実発送通知は従来の403ゲートのまま。以前の合成outboxは今回も実Amazonと未接続。

## 検証

`npm run build`成功。`npm test`（Workers dry-runビルド + 合成unit/integration/security）は408/408成功。サンドボックス内の初回はlocalhost listen制限で失敗したため、許可されたローカル実行で再検証。実API、本番DBは不使用。

独立レビューは発送元不明を0件と誤表示する所見1件を発見し修正。関連15テスト成功、最終レビューに重大な未解決所見なし。独立した模擬認証検証でも古い応答拒否と401後の再取得停止を確認。

`node local/amazon-insights-qa.mjs` はloopback限定・合成データ専用。PC/390x844スマホで画面確認、ページ横はみ出しなし。同期中ボタン無効化、生成中表示、処理中ログアウト後の遅延応答、セッション期限切れ401でログイン復帰、コンソールエラーなしを確認。QAサーバーは停止済み。

証跡の数値はすべて合成:
- `amazon-fulfillment-qa/insights-synthetic-pc.png`
- `amazon-fulfillment-qa/insights-synthetic-mobile.png`
- `amazon-fulfillment-qa/insights-synthetic-expired.png`

## 実接続前の確認・保留事項

1. 本人がSPPへログイン後、Develop Appsで対象アプリと登録ユースケース/承認ロールを確認する。アプリ識別が済むまで別のAds/Appstoreアプリと同一扱いしない。配送状態に必要なInventory and Order Tracking、JP自社発送住所にはDirect-to-Consumer Shipping (Restricted)の実grantを確認。今回はログイン操作自体が未承認のため保留。
2. Ads APIの申請元アカウントで承認状態を本人確認。SP-APIとは別認可。認可/Secrets設定には別の明示承認が必要。対象JPプロフィール、JPY、Asia/Tokyo、seller/vendor、利用できる実際のユーザー権限を照合する。架空のread-only OAuthスコープは使わない。現実のスコープはadvertising::campaign_managementだが、本コードは広告設定/予算更新APIを実装しない。
3. 住所表示には単一の個別管理者IDとMFAの強制、最小権限、暗号化・鍵管理、閲覧監査、保持/削除運用、目的と表示項目の明示確認が必要。合成の認証/削除機構を本番D1対応済みとは扱わない。満たすまで403。
4. 今回の新フィールドは実APIで未検証。承認後の限定的な読み取り検証と500件/31日範囲の運用確認が必要。より古い未発送注文の全件管理は別途要件を決める。公開・push・PR・merge・deployは別承認待ち。

## 公式根拠

- [Orders v2026公式モデル](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/orders-api-model/orders_2026-01-01.json): OrderFulfillment.shipByWindow.latestDateTime、fulfilledByは任意、PackageStatus.status。
- [Orders移行ガイド](https://developer-docs.amazon.com/sp-api/docs/orders-api-migration-guide): FULFILLMENT/PACKAGES/RECIPIENTの分離、MERCHANTとAMAZON。
- [PIIアクセス](https://developer-docs.amazon.com/sp-api/docs/access-orders-pii): JP自社発送住所のRestrictedロール、v2026はRDT不要。
- [Ads v3 campaign report](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/campaign)、[columns](https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/columns): SP日次cost/sales7d・14d/clicks/impressions。帰属窓は対象アカウントの確認結果で決める。
- [Ads attribution help](https://advertising.amazon.com/help/GX7KDKHMWQYMJ385): 成約反映の遅延・帰属期間終了前の未確定値。固定72時間で確定とは表示しない。

## ローカルコミット前の再確認

2026-10-27にGitHubへls-remoteを再実行し、上記main/実アプリブランチのSHAが変わっていないことを確認。実アプリブランチは357c39dから先行0・遅延0。mainはREADME.mdのみのInitial commitで、357c39dとの共通祖先なし（対称差はアプリ側240コミット/main側1コミット）。mainの1コミットを「357c39d以降の更新」と解釈しない。rebase/merge/fetchによる作業基点変更はしていない。将来の統合先はアプリを含む実ブランチと照合する。

今回の明示した15ファイルだけをコミット対象にし、秘密設定・実顧客データ・実画面のスクリーンショットは含めない。QA画像3枚は合成サーバーの画面で、認証画面にも入力値なし。追加行の資格情報パターン確認と目視確認を実施。最新408テスト成功時点からコード変更なし。検証対象コードのSHA-256とテストログのハッシュは `amazon-insights-verification.json` に記録し、この文書と同じコミットに対応付ける。実API未検証・住所403・認可待ちは継続。
