# Amazon Selling Partner API（SP-API）連携の手順

2026-10-17 に Amazon 公式ドキュメント（developer-docs.amazon.com/sp-api）で確認した内容です。

## 対象と方式

- 対象マーケットプレイス: Amazon.co.jp（Marketplace ID `A1VC38T7YXB528`）、エンドポイント `https://sellingpartnerapi-fe.amazon.com`（Far East）、Seller Central `https://sellercentral.amazon.co.jp`
- 認可: Login with Amazon（LWA）の公式フロー。Amazonのパスワードはこのアプリに入力・保存しません。
  - Webサイト認可フロー（アプリの「Amazonを認可する」→ Seller Centralで同意 → 自動で戻る）
  - または セルフ認可（Seller Centralの「アプリの開発」→「アプリを認可」で発行したリフレッシュトークンを Cloudflare Secret `AMAZON_REFRESH_TOKEN` に登録）
- 取得API
  - Sales API v1 `getOrderMetrics`（日別売上・注文件数・点数）。必要ロール例: 「在庫と注文の追跡（Inventory and Order Tracking）」
  - Orders API v2026-01-01 `searchOrders`（注文の配送状況）。旧 v0 `getOrders` は 2027-03-27 までに移行が必要と告知されているため新版を使用
- 購入者の氏名・住所等（PII）は要求・保存しません（制限付きロール不要）。

## 集計の定義

| 項目 | 定義 |
| --- | --- |
| 売上 | Sales API の `totalSales`。注文日（日本時間）ベース、購入者区分すべて・FBA/自己発送すべて。Amazonの集計値で、返品・返金は差し引かれません。キャンセルの扱いは公式資料に明記がないため、キャンセル件数は Orders API 側で別表示します。手数料・送料控除後の入金額ではありません。 |
| 注文件数 | Sales API の `orderCount`（日別）。今月分は日別の合計。 |
| 発送状況 | Orders API で、集計期間内に作成された注文を `fulfillmentStatus` 別に件数化。未発送 = `UNSHIPPED` + `PARTIALLY_SHIPPED`。`CANCELLED` は別計上。最大500件（5ページ）。 |
| 集計期間 | 同期時点から直近31日（日本時間 00:00 起点、終了は同期時刻の5分前） |
| 同期 | 手動（「今すぐ同期」）と毎日 09:10（日本時間）の自動同期。失敗時は前回成功データを残し、エラーを表示。 |

レート制限（公式既定値）: getOrderMetrics 0.5回/秒・バースト15、searchOrders 約0.0056回/秒・バースト20。手動同期を短時間に繰り返すと429になることがあります。

## 本人が行う設定

1. **Seller Central（大口出品のプライマリユーザー）**にログインし、「アプリとサービス」→「アプリの開発」で開発者プロフィールを登録します（非公開＝自社のみ利用、ロールは「在庫と注文の追跡」）。Amazonの審査があり、追加質問には5日以内に回答が必要です。
2. 承認後、「アプリを追加」で SP-API アプリを作成（下書きのままで可）。
3. アプリの設定に次を登録します（URLは公開後に表示される実URLに置き換え）。
   - OAuthログインURI: `https://<公開URL>/api/amazon/login`
   - OAuthリダイレクトURI: `https://<公開URL>/api/amazon/callback`
4. LWA認証情報（Client ID / Client Secret）とアプリID（`amzn1.sp.solution...`）を確認し、Macのターミナルで1つずつ登録します（値は画面に表示されず、チャットに貼る必要はありません）。
   ```sh
   cd ~/Sites/SICK-STYEL
   npx wrangler secret put AMAZON_LWA_CLIENT_ID
   npx wrangler secret put AMAZON_LWA_CLIENT_SECRET
   npx wrangler secret put AMAZON_APP_ID
   ```
   アプリを公開（Published）した場合のみ `AMAZON_APP_DRAFT` を `false` に設定します（既定は下書き用の `version=beta` を付与）。
5. SICKSTYLEにログイン →「Amazon連携」→「Amazonを認可する」→ Seller Centralで内容を確認して同意 → 自動でアプリへ戻ったら「今すぐ同期」。

セルフ認可を使う場合は 4 の後、Seller Centralでアプリの「認可」を押してリフレッシュトークンを発行し、`npx wrangler secret put AMAZON_REFRESH_TOKEN` で登録します（Web認可フローの設定は不要）。

## 認可前・認可待ちの使い方

「売上・SNS実績」で日次の売上・注文件数を手入力、または CSV を取り込めます。CSVは1行目が見出し（例: `日付,売上,注文件数`）。Seller Central のビジネスレポート（日付別）をCSVで保存し、取込時に列を選べます。同じ日付は売上・注文だけ上書きします。

## 解除

「接続を解除」で暗号化済みトークンと取得データを削除します。Seller Central の「アプリとサービス」メニュー内の認可済みアプリの管理画面からも認可を取り消せます。セルフ認可のトークンは `npx wrangler secret delete AMAZON_REFRESH_TOKEN` で削除します。

## 公式資料

- [Sales API](https://developer-docs.amazon/sp-api/docs/sales-api) / [getOrderMetrics](https://developer-docs.amazon/sp-api/reference/getordermetrics)
- [Orders API](https://developer-docs.amazon/sp-api/docs/orders-api) / [searchOrders](https://developer-docs.amazon/sp-api/reference/searchorders) / [v2026-01-01 の告知](https://developer-docs.amazon/sp-api/changelog/new-introducing-the-orders-api-v2026-01-01) / [移行ガイド](https://developer-docs.amazon/sp-api/docs/orders-api-migration-guide)
- [Webサイト認可フロー](https://developer-docs.amazon/sp-api/docs/website-authorization-workflow) / [セルフ認可](https://developer-docs.amazon/sp-api/docs/self-authorization.md) / [非公開開発者の登録](https://developer-docs.amazon/sp-api/docs/register-as-a-private-developer.md)
- [SP-APIへの接続（LWA）](https://developer-docs.amazon/sp-api/docs/connecting-to-the-selling-partner-api.md) / [エンドポイント](https://developer-docs.amazon/sp-api/docs/sp-api-endpoints.md) / [Marketplace ID](https://developer-docs.amazon/sp-api/docs/marketplace-ids) / [Seller Central URL](https://developer-docs.amazon/sp-api/docs/seller-central-urls.md)
