# Amazon Selling Partner API（SP-API）連携の手順

2026-10-17 に Amazon 公式ドキュメント（developer-docs.amazon.com/sp-api）で確認した内容です。

## 対象と方式

- 対象マーケットプレイス: Amazon.co.jp（Marketplace ID `A1VC38T7YXB528`）、エンドポイント `https://sellingpartnerapi-fe.amazon.com`（Far East）、Seller Central `https://sellercentral.amazon.co.jp`
- 認可: Login with Amazon（LWA）の公式フロー。Amazonのパスワードはこのアプリに入力・保存しません。
  - セルフ認可（推奨・非公開アプリ）: 発行したリフレッシュトークンを Cloudflare Secret `AMAZON_REFRESH_TOKEN` に登録
  - Webサイト認可フロー（任意）: アプリの「Amazonを認可する」→ Seller Centralで同意 → 自動で戻る
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

## 要件（2026-10-17 確認）

- **大口出品（Professional）アカウント**が必要。小口出品は対象外（アップグレードは有料プランの契約になるため、このアプリの作業では行いません）。
- 登録できるのは Seller Central の**プライマリユーザー**のみ。
- 開発者登録は **Solution Provider Portal（SPP）** に移行済み。Seller Central の「アプリの開発」から自動で移動します。
- **料金**: 2025年11月に告知されたSP-APIの年額・従量料金は、2026年5月14日にAmazonが「現時点では実施しない」と撤回。なお当初案でも、自社業務のためだけに使う出品者（非公開開発者）は対象外でした。SPPで支払い方法の登録を求められても入力不要です。
- 審査あり（期間の公表なし）。Amazonから追加質問が来たら5日以内に回答。

## 推奨する認可方式: セルフ認可（非公開アプリ）

自社のセラーアカウント1つだけを連携するので、Amazon公式の「非公開アプリのセルフ認可」を使います。アプリは下書き（Draft）のままで認可でき、OAuthのリダイレクトURI設定は不要です。発行されたリフレッシュトークンは、Macのターミナルの非表示入力からCloudflare Secretに保存します（チャット・ログ・Gitに残しません）。

（Webサイト認可フローも実装済みです。使う場合のみ、アプリにOAuthログインURI `https://<公開URL>/api/amazon/login`、リダイレクトURI `https://<公開URL>/api/amazon/callback` を登録し、`AMAZON_APP_ID` を設定します。）

## 本人が行う設定（1段階ずつ）

1. https://sellercentral.amazon.co.jp にプライマリユーザーでログイン。左上「≡」→「設定」→「出品用アカウント情報」で出品プランが「大口出品」か確認。
2. 「≡」→「アプリとサービス」→「アプリの開発」を開く（Solution Provider Portal へ移動。直接 https://solutionproviderportal.amazon.com/home でも可）。
3. 開発者プロフィールを登録: 連絡先 → データアクセスは「**非公開開発者**（自社のためだけにアプリを構築）」→ ロールは「**在庫と注文の追跡**（Inventory and Order Tracking）」のみ → ユースケース（下の例文）→ セキュリティ管理の質問 → 規約に同意して登録。
4. 承認メールを待つ。
5. SPPの「Develop Apps」→「Add new app client」: アプリ名 `SICKSTYLE Manager`、API種別 `SP API`、`Sellers` にチェック、ロール「在庫と注文の追跡」→ 保存（下書き）。
6. アプリ一覧の「LWA credentials」→「View」でクライアントID/シークレットを表示し、Macのターミナルで登録:
   ```sh
   cd ~/Sites/SICK-STYEL
   npm run integrations:amazon        # アプリIDは空欄でEnter
   ```
7. アプリの「Authorize」（または「Manage Authorizations」→ Amazon.co.jp のセラーアカウント）でリフレッシュトークンを発行し、すぐに登録:
   ```sh
   npm run integrations:amazon-refresh
   ```
8. SICKSTYLE →「Amazon連携」→「今すぐ同期」。売上・注文の実データが表示されたら連携完了。

### 開発者プロフィールのユースケース例文（そのまま使えます）

> 自社のAmazon.co.jpセラーアカウント専用の社内管理ツールです。Sales APIで日別の売上合計・注文件数を、Orders APIで注文の配送状況（未発送・発送済み・キャンセルの件数と注文番号）を1日1回および手動で取得し、社内の目標管理画面に表示します。購入者の氏名・住所・連絡先などの個人情報は取得しません。取得データは自社のみが閲覧でき、ログイン認証付きのサーバーで管理し、第三者へは提供しません。認証情報は暗号化して保存します。

## 認可前・認可待ちの使い方

「売上・SNS実績」で日次の売上・注文件数を手入力、または CSV を取り込めます。CSVは1行目が見出し（例: `日付,売上,注文件数`）。Seller Central のビジネスレポート（日付別）をCSVで保存し、取込時に列を選べます。同じ日付は売上・注文だけ上書きします。

## 解除

「接続を解除」で暗号化済みトークンと取得データを削除します。Seller Central の「アプリとサービス」メニュー内の認可済みアプリの管理画面からも認可を取り消せます。セルフ認可のトークンは `npx wrangler secret delete AMAZON_REFRESH_TOKEN` で削除します。

## 公式資料

- [SP-API登録の概要（大口出品・プライマリユーザー要件）](https://developer-docs.amazon/sp-api/docs/sp-api-registration-overview.md) / [Solution Provider Portal FAQ](https://developer-docs.amazon/sp-api/docs/spp-faq.md) / [アプリの登録](https://developer-docs.amazon/sp-api/docs/registering-your-application.md)
- 料金撤回の報道: [PPC Land（2026-05）](https://ppc.land/amazon-drops-sp-api-fees-after-developer-pushback)

- [Sales API](https://developer-docs.amazon/sp-api/docs/sales-api) / [getOrderMetrics](https://developer-docs.amazon/sp-api/reference/getordermetrics)
- [Orders API](https://developer-docs.amazon/sp-api/docs/orders-api) / [searchOrders](https://developer-docs.amazon/sp-api/reference/searchorders) / [v2026-01-01 の告知](https://developer-docs.amazon/sp-api/changelog/new-introducing-the-orders-api-v2026-01-01) / [移行ガイド](https://developer-docs.amazon/sp-api/docs/orders-api-migration-guide)
- [Webサイト認可フロー](https://developer-docs.amazon/sp-api/docs/website-authorization-workflow) / [セルフ認可](https://developer-docs.amazon/sp-api/docs/self-authorization.md) / [非公開開発者の登録](https://developer-docs.amazon/sp-api/docs/register-as-a-private-developer.md)
- [SP-APIへの接続（LWA）](https://developer-docs.amazon/sp-api/docs/connecting-to-the-selling-partner-api.md) / [エンドポイント](https://developer-docs.amazon/sp-api/docs/sp-api-endpoints.md) / [Marketplace ID](https://developer-docs.amazon/sp-api/docs/marketplace-ids) / [Seller Central URL](https://developer-docs.amazon/sp-api/docs/seller-central-urls.md)
