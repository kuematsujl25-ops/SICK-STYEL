# SICKSTYLE団体営業：Zoom × Googleカレンダー連携セットアップ

現在の実装: 団体営業の初回Zoom・活用法提案Zoomの日時からZoom会議を作り、Googleのメインカレンダーに45分の予定を登録する。外部の参加者へのメール招待は自動で送信しない。

## 1. Zoom OAuthアプリの作成
- https://marketplace.zoom.us/ にZoom管理者または開発者権限のある本人アカウントでログイン。
- Developers → Build App → General App （ユーザー認可型）を作成。「Server-to-Server OAuth」と取り違えない。
- OAuth Redirect URL とOAuth Allow Listに、本番URL（https://sickstyle-manager.sickstyle-74h4.workers.dev）及び次のコールバックを登録：

`https://sickstyle-manager.sickstyle-74h4.workers.dev/api/zoom/callback`

- Meetings の会議作成・更新・削除と、ユーザー自身のプロフィール読み取りの最小スコープを許可する。
  - meeting:write:meeting
  - meeting:update:meeting
  - meeting:delete:meeting
  - user:read:user
- 必要に応じ、Zoom App MarketplaceのLocal Testで管理者本人がアプリを追加して許可する。開発用と本番用のOAuth認証情報は別物の場合があるため、使う環境とredirect URIを一致させる。
- Zoom Client ID/Client Secretを本人だけが安全に確認。GitHub、ChatGPT、PRには値を記載しない。

## 2. Google Calendar OAuthクライアントの作成
- https://console.cloud.google.com/ で本人のGoogle Cloudプロジェクトを作成または選択。
- APIとサービス（Google Auth Platformの導線に変更されている場合は Branding/Audience/Data Access/Clients）でGoogle Calendar APIを有効化。
- OAuth同意画面でアプリ名・サポートメールを登録し、イベント管理スコープを要求：

`https://www.googleapis.com/auth/calendar.events`

- アプリ公開状態・テストユーザーをGoogleの画面上の指示に従って設定。テスト状態ではリフレッシュトークンが期限切れになる場合がある。公開にはGoogleの検証が必要なケースもあるため、無条件で承認済みと見なさない。
- OAuthクライアント（Web application）を作り、Authorized redirect URIを次に設定：

`https://sickstyle-manager.sickstyle-74h4.workers.dev/api/googlecalendar/callback`

- 最小スコープではユーザーのメールアドレスは取得しない。この情報を取得するためだけにGoogle OAuthのprofile/email権限を増やさない。
- OAuth Client ID/Client Secretは本人のみが管理し、チャットやGitHubへ貼らない。

## 3. Cloudflare Secretsの本人登録（本番へ変更）
- MacでSICKSTYLEの最新GitHubコードを取得し、既存の未コミット差分を消さない。
- 次の計画表示を実行して、変更先が `sickstyle-manager` / 本番URLと一致するか確認する：

```bash
npm run integrations:zoom -- --plan
npm run integrations:googlecalendar -- --plan
```

- ユーザーが本番Secretsの変更を明示承認した後、Macターミナルで以下を実行。確認文言はスクリプトに従い、Client Secretは非表示の対話入力で渡す：

```bash
npm run integrations:zoom -- --apply
npm run integrations:googlecalendar -- --apply
```

- APP_ORIGINやTOKEN_ENCRYPTION_KEYを置換しない。Secretsの変更は本番WorkerのVersionに影響する可能性があるため、Cloudflareの最新デプロイと利用状況を確認する。

## 4. SICKSTYLE管理アプリで本人認可
1. https://sickstyle-manager.sickstyle-74h4.workers.dev/ に管理者ログイン。
2. 左メニュー「設定・バックアップ」の下部の「Zoom × Googleカレンダー連携」へ移動。
3. 「Zoomを接続」からZoom公式OAuth画面で本人認可。
4. 「Googleカレンダーを接続」からGoogle公式OAuth画面で本人認可。
5. 両方の接続状態が「接続済み」となったことを確認。

## 5. 団体営業で1件動作確認
1. 団体営業 → 団体を追加/編集 → 団体名・担当者・初回Zoom開始日時を保存。
2. もう一度団体を編集 → 「MTGを作成」。
3. Zoom参加URLとGoogleカレンダーの45分予定を照合。Googleのメインカレンダーへ登録される。
4. 日程を変える場合は日時を保存してから「日程を同期し直す」。取消は「MTGを取消」。
5. Zoomだけ作成されてCalendarに失敗した場合、同じZoom会議を再利用してカレンダーだけ再試行。
6. 削除の一部が失敗した場合は未取消のIDを保護して「取消を再試行」に進む。予期せぬ不一致があればZoom・Calendar側の実状態を手動確認する。

## 未対応
- 参加者への個別招待メール送信は自動化していない。Googleの予定を開き、出席者は本人が確認して追加する。
- Googleカレンダーの空き時間検索・招待可否の照合は別機能。実際の予定登録時点でダブルブッキングを完全には防げない。
- API登録・OAuth認可が未完了の間は自動連携は有効にならない。ChatGPT側のZoom/Googleカレンダー接続をSICKSTYLEへ流用しない。
- 利用プランやスコープ、個人情報アクセス、外部招待の権限・費用について公式条件を確認する。

## 公式リファレンス
- https://developers.zoom.us/docs/integrations/create/
- https://developers.zoom.us/docs/integrations/oauth-scopes-granular/
- https://developers.google.com/workspace/calendar/api/auth
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
