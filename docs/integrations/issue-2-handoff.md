# Issue #2 — 本人認証への引き継ぎ

2026-10-18（日本時間）。Issue: https://github.com/kuematsujl25-ops/SICK-STYEL/issues/2

## 現在の判定

| サービス | 判定 | 根拠 |
|---|---|---|
| Instagram | **認証待ち**・同期未検証 | 本人回答が「Metaアプリの設定待ち」。端末制限は「未確認・まだ制限中」。実トークン・実Insightsは未確認 |
| Amazon | **認証待ち**・同期未検証 | 本人回答が「SP-APIのアプリ設定待ち」。既存の大口契約・プライマリユーザーログイン可。SPPアプリ・認可は未確認 |
| Canva | **利用不可（このチャットのMCP経由）** | Issueには別のChatGPT環境で接続済みとの記録があるが、今回の利用可能ツールにCanvaデザイン検索・取得・OAuth操作がない。既存ブランドキット・デザインは未検索 |
| BASE | **利用不可（現状の自動接続）** | 認可なし、アダプターなし。公式旧ドメインは新ドメインへ転送され、API資料は404で現行の無料条件を確認できず |
| TikTok | **認証待ち**・同期未検証 | 公式Display APIは確認したが、このアプリには認可・読取アダプターがない。アプリ審査・本人認可・料金条件の確認が必要 |
| Metricool | **認証待ち（公式Free MCPの候補）**・同期未検証 | 公式はFreeプランのMCP対応を明記。今回のチャットにそのMCPツールはなく、接続は未検証。REST APIはAdvanced以上のため採用しない |

本番公開ページと`/api/session`はHTTP 200で応答し、管理者設定済みのD1アプリであることを確認した。Privacy/Data deletionの.html URLは307で正規化され、リダイレクト先はHTTP 200。両サービスのcallbackは未ログインで303となり、管理者ログインへ戻ることを確認した。認証済みセッションは本人のブラウザー内にあり、この実行環境にはない。Cloudflareの`whoami`は未認証。ローカルの変数・設定は**名前と有無だけ**点検した。ローカル未設定を根拠に、本番Secretsが存在しないとは断定していない。新しいSecretsやVariablesは要求・変更していない。

## いま開ける本人用画面

- 本番アプリ: https://sickstyle-manager.sickstyle-74h4.workers.dev/
- Metaのアプリ管理: https://developers.facebook.com/apps/
- Meta開発者登録: https://developers.facebook.com/
- Amazon.co.jp Seller Central: https://sellercentral.amazon.co.jp/
- Amazon Solution Provider Portal: https://solutionproviderportal.amazon.com/home
- Canvaの公式MCP案内: https://www.canva.com/help/mcp-agent-setup/
- Metricoolの公式MCP案内: https://metricool.com/metricool-mcp-claude/

これらは実際の公式ログイン／案内先。App IDやセッションがないまま作った偽のOAuth URLは提示しない。ユーザーの端末のタブをこの環境から開く機能はないため、リンクを普段の端末で開く。パスワード・ワンタイムコード・トークン・Cookieをチャットへ送らない。

## Instagram — 制限解除後の本人操作

1. 普段Facebook/Instagramを使う端末でMetaへログイン。開発者登録が端末セキュリティ制限中なら、その時点で停止して公式の解除を待つ。別端末・アカウント・非公式手段で回避しない。
2. 既存Metaアプリを探し、重複作成せず、対象プロアカウント（ビジネス／クリエイター）とアプリロール・Instagramテスター招待を確認する。Instagram Login方式ではFacebook Pageリンクは不要。
3. Instagram Loginの必要権限は`instagram_business_basic`と`instagram_business_manage_insights`。既存のメッセージ機能が有効なら`instagram_business_manage_messages`も要求されるが、Insightsだけなら不要。本番の設定変更や権限追加は今回行わない。
4. MetaのOAuth redirect URIを、次の値と完全一致させる。コールバックはログイン済み管理者のセッションに結び付いた一度限りのstateを使う。本人の管理アプリから「Instagramを接続」を押して生成する。

   `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/instagram/callback`

   Privacy Policy: `https://sickstyle-manager.sickstyle-74h4.workers.dev/privacy.html`

   Data deletion: `https://sickstyle-manager.sickstyle-74h4.workers.dev/data-deletion.html`

5. Cloudflareの既存設定名を本人が確認する。`INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`と、既存の`TOKEN_ENCRYPTION_KEY` / `APP_ORIGIN`が必要。暗号化キーの置換は既存トークンを復号不能にするため行わない。値は送らない。
6. Secrets登録・本番反映は別途承認待ち。登録前に以下の**計画表示だけ**を利用できるが、これは本PRの修正版を使う場合に限る。旧版のスクリプトは`--plan`を無視して登録を始めるため実行しない。

   ```sh
   npm run integrations:instagram -- --plan
   ```

7. 設定と本人認可が完了した後、管理画面の「今すぐ同期」を1回実行。プロフィール、Insights、最終成功日時、未取得指標、警告を確認する。取得済みの売上・個人情報をGitHubへ保存しない。権限不足・認可期限切れでは再認可する。取得失敗時の以前の値を最新実績としない。SNS投稿・DM送信は行わない。

**料金・制限:** 公式の対象・スコープは確認済み。ただし本人のプランや実使用上限・全条件は未確認で、無料と推測して新しい有料APIを呼ばない。メディアInsightsはオーガニックと広告込み指標を区別する。未提供・権限不足はnullで、0とは区別する。既存同期は最新25メディアのリールを対象にし、必要な再認可とトークン更新を既存コードで扱う。

## Amazon — 既存大口契約を利用する本人操作

1. 既存の大口出品契約・プライマリユーザーでSeller Centralへログインする。有料アップグレード、支払い情報登録、試用開始は行わない。求められたら止める。
2. 「アプリとサービス」→「アプリの開発」からSPPへ進み、既存の自社用プライベート開発者／アプリの登録状態を確認する。既存アプリがあれば再利用する。登録や利用で費用が表示された場合は、無料と判断せず停止する。
3. 自社Amazon.co.jp向け、必要な読み取りロール（Sales/Ordersの利用資格・Inventory and Order Tracking）を確認する。新しい価格・在庫・商品ページ更新、Ads API、PII取得を追加しない。アプリはDraftのままセルフ認可可能で、公開は不要。
4. アプリの「Authorize app」／「Manage Authorizations」へ進み、対象の自社アカウントを確認して本人が認可する。LWAクライアント情報と生成されたrefresh tokenは本人の安全な保管先で扱い、チャット・Issue・PRへ貼らない。
5. セルフ認可ではWebサイト用の`AMAZON_APP_ID`やOAuth callbackの登録は不要。Webサイト認可を使う場合だけ、以下の組を利用する。

   Login: `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/amazon/login`

   Callback: `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/amazon/callback`

6. 登録が必要な名前は`AMAZON_LWA_CLIENT_ID`、`AMAZON_LWA_CLIENT_SECRET`、`AMAZON_REFRESH_TOKEN`。既存の暗号化キーは変更しない。Secrets登録・本番反映は承認待ち。本PR修正版の変更なし計画表示は次の2つ。

   ```sh
   npm run integrations:amazon -- --plan
   npm run integrations:amazon-refresh -- --plan
   ```

7. 登録・本人認可の完了後、「Amazon連携」→「今すぐ同期」を1回実行し、**SalesとOrdersを別々に**確認する。片方が失敗すれば同期未検証。一方の成功を使って、もう一方の古い期間・数値を最新にしない。
8. 日付はJST、金額はJPY、API売上と手入力・CSVは合算しない。APIは手数料控除後の入金や粗利ではない。キャンセル・返品・返金の定義も確認する。初回データとSeller Centralの同一定義・同期間の値を本人が照合する。実数はチャットへ送らず「成功/失敗・日時・未取得項目」だけで検証結果を共有できる。

**料金・制限:** 私的アプリの登録には既存大口契約が必要と公式で確認。既存契約の料金を「今回の追加費用0円」と混同しない。SPPの最新料金条件が明確になるまで費用0を断言せず、課金が必要なら同期を始めない。Sales/Ordersの使用プランは操作別で、実レスポンスの`x-amzn-RateLimit-Limit`や429に従う。コードはOrders最大5ページ・500件で打ち切りを表示し、無制限再試行を追加していない。

## 設定登録コマンドの停止条件

本PRの既定動作と`--plan`は、公開Worker名・設定名・URLの出力のみ。ネットワーク呼び出し・設定書込は行わない。`--apply`は別途承認された将来の本人操作専用で、TTYと対象Worker名の確認を要求し、値を非表示入力する。

**`wrangler secret put`は本番Workerへの反映を伴う可能性がある。Secrets登録だけの承認を本番反映の承認に読み替えない。今回は禁止されているため、--apply / wrangler secret put / deployは実行しない。** Meta/Amazonのアプリ登録・秘密情報発行画面でも、既存状態の確認後、無承認で変更を進めない。

## Canva — コネクタ公開までの準備

Canva Dev MCPはCanvaアプリ開発用のドキュメント支援であり、ブランド素材やデザインを検索するCanva AI Connectorとは別物。Dev MCPをインストールして接続済みと報告しない。現在のチャットにデザイン用ツールが公開されていないため、実際のブランド検索・Brand Kit閲覧・既存デザイン編集・エクスポートは未実施。

次回このチャットでデザイン用Canvaツールを利用可能にし、本人OAuthを行った後、まず読み取りでSICK STYLE素材を検索する。生成AIクレジット・有料素材・Pro限定機能の必要性が不明なら使わない。既存デザインを上書きしない。

`canva-handoff.md`と`canva-handoff.svg`は、既存アプリのロゴ参照・色・サイズをもとにコードで作った無料の引き継ぎ素材。Canvaで作成済み・Brand Kit確認済みという意味ではない。

## BASE・TikTok・Metricoolの無料代替

`templates/`のCSVは未取得セルを空欄にした収集用ひな形。数字は本人が公式管理画面で確認した場合のみ記入し、未取得を0にしない。顧客名・メール・住所・注文番号・トークンを入れない。CSVは手元で管理しGitへ追加しない。**BASEの売上やTikTok指標を、既存アプリのAmazon売上CSVへ取り込まない。** 異なるチャネルを混ぜない。

- BASE: 現行の公式無料API条件は確認できず自動接続は停止。本人が公式管理画面で閲覧・取得できる項目だけを`base.csv`へ手動で記録する。CSV自動エクスポートが無料と断言していない。
- TikTok: 公式Display APIはプロフィール・公開動画の読取API。`user.info.basic` / `video.list`等の必要スコープ、アプリ審査・本人認可・制限が前提。売上・広告・高度な分析APIとは区別する。現時点は`tiktok.csv`への手動記録までで、投稿・広告APIは使わない。
- Metricool: 公式料金表ではMCPがFreeに含まれ、公式MCP案内も「Freeを含む全プラン」と明記。本人OAuthと対応MCPクライアントが必要で、今回のチャットにはツールがない。MCPには書き込み機能もあるため、将来接続しても投稿・予約変更は許可しない。Freeは履歴30日などの制限がある。REST APIはAdvanced以上で有料のため使わない。当面は`metricool.csv`へ手動記録する。AIアシスタントの従量費用や追加クレジットが発生する利用は承認待ち。

## 参照した公式資料

- Meta Login: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- Meta Media Insights: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
- SP-API登録: https://developer-docs.amazon/sp-api/docs/sp-api-registration-overview.md
- 私的アプリの認可: https://developer-docs.amazon/sp-api/docs/self-authorization.md
- Sales操作: https://developer-docs.amazon/sp-api/reference/getordermetrics
- Canva Dev MCPとAI Connectorの区別: https://www.canva.dev/docs/connect/mcp-server/
- Canva AI Connector案内: https://www.canva.com/help/mcp-agent-setup/ （今回の取得はプロキシ403。Dev資料の公式リンクとして確認）
- BASE旧サイト: https://developers.thebase.in/ → https://developers.thebase.com/ （API資料404。現行条件は未確認）
- TikTok Display: https://developers.tiktok.com/doc/display-api-overview/
- TikTok制限: https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit/
- Metricool料金: https://metricool.com/pricing/
- Metricool MCP: https://metricool.com/metricool-mcp-claude/
