# Phase U: 団体営業・選手調査・Zoom×Googleカレンダー連携（2026-10-21更新）

## 団体営業6段階フロー（実装済み）

- 団体営業の表示を「DM → ZOOM → サンプル → 試用 → 活用法提案ZOOM → 導入」の6段階に整理。細かい予約・実施・到着確認・継続購入の既存ステータスと履歴はそのまま残る（スキップ・後戻りも履歴に記録）。
- PC/スマホとも同じ一覧（`.listrow`）を使うレスポンシブ表示。「停滞案件（14日以上動きなし・失注/連絡不要/継続購入は対象外）」「次の行動が期限超過」の件数をダッシュボード上部に表示し、停滞中の団体には行内バッジを表示する。
- KPI・転換率タブは既存のまま（ファネルの分子・分母・開始月別コホート）。

## Zoom × Googleカレンダー連携（コード実装済み・本番認可は本人操作待ち）

今回のPRで実装したもの:

- `integrations/zoom.js` / `integrations/googlecalendar.js`: OAuth（Authorization Code、Zoomは`meeting:write/update/delete:meeting`+`user:read:user:me`、Googleは`calendar.events`のみ・オフラインアクセス）。既存のInstagram/Amazon連携と同じ`ss_oauth`テーブルでCSRF state検証、`lib/security.js`のAES-256-GCMでリフレッシュトークンを暗号化し`zoom-private`/`googlecalendar-private`文書に保存。
- `lib/meeting-sync.js`: 団体ごとの「初回ZOOM」「活用法提案ZOOM」をZoom会議作成→Googleカレンダー登録の順で冪等に実行。
  - 既にsynced（両方成功）な場合は何もしない（二重会議作成の防止）。
  - Zoom成功後にその場で`zoomMeetingId`・`join_url`・`status:'zoom_only'`を保存してから Calendar 登録を試みる。Calendarだけ失敗した場合は`status:'error'`として記録し、再試行時はZoomを再発行せずCalendarだけやり直す。
  - 日程変更（`action:'update'`）はZoom・Calendar双方のイベントを更新。取消（`action:'cancel'`）は両方の削除を試みてからローカルの同期状態をクリアする（片方の削除APIが失敗しても警告を返しつつローカルは取消状態にする）。
  - ワークスペース文書の`revision`による楽観ロックで、他端末の同時更新と競合すれば409エラーを返す。
  - Zoomの`start_url`（ホスト専用URL）は一切保存・返却しない。`join_url`のみを団体の`initialZoomUrl`/`proposalZoomUrl`に設定する。
- `api/index.js`: `/api/zoom/*`・`/api/googlecalendar/*`（status/connect/callback/disconnect）と`/api/orgsales/meeting`（MTG作成・更新・取消）、`/api/orgsales/meeting-status`を追加。いずれも既存のログイン必須ゲートを通る。
- 管理画面「設定・バックアップ」にZoom/Googleカレンダーの接続状態・切断ボタン・アプリ登録手順（下記）を表示。団体編集画面は、両方接続済みかつ団体が保存済みの場合のみ「MTGを作成」等のボタンを表示し、未接続時は既存の手動URL入力＋Googleカレンダー予定作成リンク（自動登録ではない）にフォールバックする。

### 本人が行う必要がある操作（コードでは完了できない）

1. **Zoom**: [Zoom App Marketplace](https://marketplace.zoom.us/) でOAuthアプリ（ユーザー認可が必要なタイプ。Server-to-Server OAuthではない）を作成し、Redirect URLに `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/zoom/callback` を登録。Scopesは本文中の4つの最小権限のみ。
2. **Googleカレンダー**: [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成しCalendar APIを有効化、OAuth同意画面のスコープに `https://www.googleapis.com/auth/calendar.events` を追加し、**公開ステータスを「本番環境」に**（「テスト中」のままだとリフレッシュトークンが7日で失効する）。OAuthクライアント（ウェブアプリケーション）のリダイレクトURIに `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/googlecalendar/callback` を登録。
3. 両方のClient ID/Secretを確認後、`npm run integrations:zoom -- --plan` / `npm run integrations:googlecalendar -- --plan` で登録内容を確認し、本番反映が別途承認された場合のみ `--apply` でCloudflare Secretsに登録（この一連の操作はターミナルでの明示承認が必要で、コードからは実行できない）。
4. 管理画面「設定・バックアップ」から「Zoomを接続」「Googleカレンダーを接続」でOAuth認可を完了する。

OAuthアプリの登録・認可が未完了の間は、団体編集画面は引き続き手動URL入力＋Googleカレンダー予定作成リンクの方式のままで、**未完成の自動連携を完成済みと表示しない**。

## 選手調査・候補管理（拡張）

- 候補に「優先度（高/中/低）」「サンプル提供状況（未提供/提供準備中/提供済み）」「連絡状況（自由記述）」「データ更新日時」を追加。旧データはこれらの項目なしでも有効（省略可能なフィールドとして検証）。
- 「ホームページ掲載」区分（非掲載/掲載候補/公開済み）は、`tier`が「提供済み」の候補にしか設定できない（`lib/domain.js`のvalidateで強制）。候補のまま勝手に公開扱いにはできない。
- Jリーグ・海外のドリブラー8名の調査候補リストは変更なし（出典・集計期間明記、未取得値はnull、CC BY 4.0写真2件のみ表示）。

## ホームページ掲載との連携（設計・実装済み）

- `lib/site.js`の公開サイトデータに`players`配列を追加（商品・お知らせと同じ`published`/`sortOrder`付き下書き→公開の仕組み）。
- 「サイト掲載」画面に「選手掲載」タブを追加。`tier==='提供済み'`の候補だけが「サイト掲載に追加」で下書きに入る（候補のまま追加はできない）。追加しただけでは非公開のままで、「掲載する」にチェックして既存の公開フロー（差分確認→公開）を通さないと公開API (`/api/public/site`) には出ない。
- 写真を掲載する場合は権利者・出典URLの両方が必須（`validateSite`で強制）。候補側の写真に権利表記がない場合は写真なしで下書きに追加される。

## 対応していないもの

- Zoom・Googleカレンダーの実際のOAuthアプリ登録・本人認可（上記「本人が行う必要がある操作」参照）。
- 写真ライセンスの自動取得・選手契約/提供実績の自動判定・サッカー有料統計の無許諾取り込み。
- 選手のフェイント数は統一定義のソースが確保できないため未取得のまま。

## 外部統計の注意

- Jリーグ 2026特別シーズン・ドリブル総数: https://www.jleague.jp/j1/stats/player/2026/dribble_count/search-list/
- 海外 2025-26 U23成功ドリブル/90分: https://www.statmuse.com/fc/ask/successful-dribbles-per-90-leaders-in-europe-top-five-2026-u23
- **Jリーグのドリブル総数と海外の成功/90を同じ指標として比較しない。** 出場分数・プレー映像・特徴・発信力・契約実現性を別軸で評価する。
- 候補を「提供済み」にするのは実際の提供契約が確認できた後だけ。ホームページへの掲載もタブで個別に確定操作が必要。

## デプロイ安全性

- Cloudflare Secrets、Cron、Workers設定、D1スキーマは今回PRで変更しない（Zoom/Googleカレンダーのトークンも既存の`ss_documents`/`ss_oauth`テーブルに保存するのみ）。
- 既存の`ss_documents`の任意フィールドを加えるだけ。バックアップの形式は維持し、古いレコード（`initialMeetingSync`等が存在しない）でも検証が成功する。
- 本番反映は別途PRレビュー・CI・事前バックアップ/復元検証・本番確認後。Codexレビューは使用上限のため保留し、その事実を記録する（Codex連携コード自体は削除しない）。
