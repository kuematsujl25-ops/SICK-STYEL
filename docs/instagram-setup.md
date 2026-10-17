# Instagram本人認可・Metaアプリ設定

2026-10-16にMeta公式ドキュメントをブラウザーで確認しました。Business Loginは2026-03-13更新、Media Insightsは2026-09-11更新、Webhook権限表は2026-10-14更新の内容を参照しています。APIは公式リファレンスに記載の `v26.0` を明示して利用します。

## 現在の状態と再開手順（2026-10-17）

- コード側の準備・公開は完了（認可画面への遷移、トークン暗号化保存、フォロワー・30日指標・リール・DM推定の同期）。
- Meta for Developers の開発者登録が「普段使用していないデバイス」の安全制限で保留中。制限の回避はせず、**普段Facebookを使っているブラウザー/端末で、Metaが変更を許可した後**に再開します。
- 再開時の順番:
  1. https://developers.facebook.com で開発者登録（規約同意・メール認証）を完了
  2. 「マイアプリ」→「アプリを作成」→ ユースケース「Instagramでメッセージとコンテンツを管理」を選択（ビジネスポートフォリオは任意）
  3. 「InstagramログインによるAPI設定」→「アクセストークンを生成」で対象のプロアカウントを追加（Instagramテスターの招待をInstagramアプリで承認）
  4. 「Instagramビジネスログインを設定」→ Business login settings の OAuth redirect URIs に `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/instagram/callback` を登録
  5. 同じ画面の Instagram App ID / App Secret を、Macのターミナル `npm run integrations:instagram` の非表示入力で登録（チャットに貼らない）
  6. アプリの基本設定にプライバシーポリシー `…/privacy.html`、データ削除 `…/data-deletion.html` を登録
  7. SICKSTYLE →「Instagram連携」→「Instagramを接続」→ Metaの公式画面で許可 →「今すぐ同期」で実データを確認

画面名はMetaの更新で変わることがあります。

## 対象と方式

ビジネス／クリエイターのプロアカウントにInstagram Loginで接続します。この方式はFacebookページとのリンクが不要です。個人用アカウントはこのInsights APIの対象外です。対象アカウント種別は所有者の回答・認可で最終確認します。

InstagramのパスワードはSICKSTYLEでは入力・使用・保存しません。認可操作はMeta/Instagramの公式画面で行います。

## 本人が設定する場所

1. [Meta App Dashboard](https://developers.facebook.com/apps/) でアプリを作成または選択します。
2. Instagram → API setup with Instagram login → Business login settings を開きます。
3. Instagram App ID / Instagram App Secret を確認し、Cloudflare Dashboard → Workers & Pages → SICKSTYLEのWorker → Settings → Variables and Secretsへ `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` として設定します。チャットへ貼り付けないでください。
4. Metaアプリの基本設定でPrivacy Policy URLに `https://実際の公開ドメイン/privacy.html`、データ削除の手順URLに `https://実際の公開ドメイン/data-deletion.html` を設定できます。記載が実際の運用に合っていることを管理者が確認してください。
5. OAuth redirect URIs に `https://実際の公開ドメイン/api/instagram/callback` を登録します。末尾スラッシュを含めて一致させてください。
6. 自分が管理するアカウントをApp Dashboardに追加し、必要なアプリロール・Instagramテスター招待を対象本人が承認します。自分の管理する登録済みアカウントはStandard Accessが対象です。管理しない他者アカウントへの提供にはAdvanced Access / App Review等が必要です。
7. Insightsに `instagram_business_basic` と `instagram_business_manage_insights` を用意します。アプリはこの2権限を要求します。
8. Cloudflare Workerに `TOKEN_ENCRYPTION_KEY`、`APP_ORIGIN`、`META_API_VERSION=v26.0` を設定して再デプロイします。
9. SICKSTYLEへログイン → Instagram連携 → Instagramを接続 → Metaの公式画面で対象アカウントを本人認可 → 戻った画面で「今すぐ同期」。必要なら `INSTAGRAM_ALLOWED_USER_ID` で接続を1つのIDに固定できます。

## 対応待ちDM（Conversations API・推奨）

- `INSTAGRAM_ENABLE_MESSAGING=true` をWorkerの変数に設定し、Metaアプリで `instagram_business_manage_messages` を利用可能にして再認可します。
- 同期時に `GET /me/conversations?platform=instagram` で直近30日に更新された会話（最大25件）を取得し、最新メッセージの送信者が自分以外の会話を「対応待ち」と数えます。
- 公式の制限: メッセージ詳細は各会話の最新20件のみ取得可能。リクエストフォルダで30日間動きのない会話は返りません。未読数・受信箱の表示とは一致しません。
- 1回の実行で外部リクエスト50件の上限があるため、判定できなかった会話は「判定不能」として件数を表示します。

## DMのWebhookを使う場合（任意）

- `INSTAGRAM_ENABLE_MESSAGING=true` をCloudflare Workerに設定し、`instagram_business_manage_messages` をアプリで利用可能にして再認可します。
- Meta App Dashboard → Webhooks（Instagram Login用設定）に callback URL `https://実際の公開ドメイン/api/instagram/webhook` を設定します。
- 検証用のランダム文字列をCloudflare Workerの `META_WEBHOOK_VERIFY_TOKEN` とMetaのVerify token欄に同じ値で設定します。
- 署名用にはMeta App settings → BasicのApp Secretを `META_WEBHOOK_APP_SECRET` に設定します。Instagram用App Secretとは役割が異なります。署名不一致ならどちらのApp Secretで署名される構成かMeta側の設定を確認してください。
- `messages` フィールドを購読します。接続時にアカウントの `/{id}/subscribed_apps` を有効化します。
- 公式権限表では `message_echoes` は別フィールドで追加権限（manage_comments）が記載されています。最小権限構成ではこの追加フィールドを要求しません。`messages`内に送信echoが届けば反映し、届かない場合は画面で手動で「対応済み」にします。
- 集計開始時刻はアカウント購読の成功時刻です。実際の受信にはMeta側のフィールド設定と本人認可の完了が必要です。必ず実DMを1件送り、受信・重複排除・対応済み処理を確認してください。
- 対応待ちは開始時点以降の受信イベントから算出した会話数です。Instagramの受信箱全体・未読件数ではなく、過去データや受信漏れを補完するものではありません。

受信署名はraw bodyに対するHMAC-SHA256で定数時間比較し、署名不一致は403。メッセージIDで再送を重複排除し、古いイベントが後着しても最新の送受信時刻で集計します。メッセージ本文は保存しません。

## 取得・更新・解除

- フォロワー数: 最終成功同期時点のスナップショット。増減は以前の日付の保存スナップショット比で、初回は未取得。
- リール: 最新25メディアに含まれるリール。`views`・`reach`・`total_interactions`・likes・comments・saved・shares。Instagram上のオーガニック実績を表示し、広告やFacebookの数値は合算しません。
- 未取得・権限不足・API空データはnullで扱い、実際の0と区別します。API応答により全指標が取得できるとは限りません。遅延は最大48時間ありえます。
- 手動同期と毎日09:00 JSTのCloudflare Cron Trigger（Workerのscheduledハンドラーから実行）で取得。失敗時は前回成功時刻とデータを残し、最新試行エラーを表示します。
- 長期トークンは暗号化してサーバー側DBだけに保存。同期時に残り7日未満・発行24時間超なら更新します。期限切れ・認可取消は再接続が必要です。稼働停止やCron失敗で60日を過ぎると自動復旧できません。
- 「接続を解除」で認可取消を試み、暗号化トークン・APIキャッシュ・DM観測履歴・認可stateをDBから削除します。取消に失敗した場合はInstagramの「アプリとウェブサイト」からも削除するよう案内します。

## 公式資料

- [Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- [Business Login / トークン更新](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Insightsの対象・権限](https://developers.facebook.com/documentation/instagram-platform/insights)
- [Media Insights / v26.0と指標](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)
- [Webhook設定・署名・購読](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)
- [Webhook権限表](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields)
- [Webhookのイベント形式](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)

公開先は無料のworkers.dev URLです。OAuth callback / privacy / data-deletion / webhookの登録先は、その実URLに合わせて設定してください。無料枠停止中のWebhook受信漏れは遡って補完できないため、画面の観測範囲を確認してください。
