# OEM会議・議事録・Amazon Ads（開発版）

## 実装と境界

- 団体営業の対象区分を団体 / OEM先に分離。既存レコードは団体として保持。会議タブは既存の2枠を維持し、各枠の種別を初回 Zoom / 活用提案 Zoom / その他から選択する。
- 前2種別だけ既存の二段階確認とZoom作成・Calendar招待を使用する。その他はアプリ内の予定保存のみで外部予約・招待を行わない。既存URL/連携記録がある枠の種別変更は拒否する。認可未完了は成功にしない。
- Notta自動連携は未接続。参加者への告知・同意とアプリ保存権限を確認した本文、要約、出典URL、会議日を手動保存する。新たなNottaアップロード・外部モデル送信は実装していない。
- 明確な単独の確定文から数値候補を抽出。保存だけでは数値を変更せず、根拠確認後の反映操作が必要。例（架空）:「試用人数は12人で確定です。」。希望数・提案数・確定導入数は別項目で、有償購入数量や売上へ推測で転記しない。曖昧な表現/単位/複数根拠/既存値は確認待ち。本文・行番号・履歴を保管し、反映を戻せる。他の編集後は取消による上書きを拒否。
- 同一出典・同一内容は再保存しても更新しない。同一出典の改訂は自動置換せず確認エラーにする。通常編集による議事録の改変・対象削除を拒否。記録は既存workspaceバックアップに含まれる。自動要約の生成やNotta webhook受信は未実装。
- Amazon Ads専用認可がない状態では同期できない。SP-APIの秘密値は流用しない。日本・JPY・Asia/TokyoのSponsored Productsのみ対象。SP以外はCSV/手入力を維持する。
- API v3非同期レポートを要求→次回に進捗確認→取得。直近31日を再取得し、profile/広告種別/日/キャンペーンのキーで置換する。売上帰属はseller 7日/vendor 14日。欠損はnull。過去スナップショット30回を保持、保存サイズ上限で停止し既存データを保全。
- 結果不明のレポート要求は自動再要求しない。管理者がAmazon側で結果を照合するまで停止する。明示的な生成失敗は過去実績を保持して1分以上空けた再試行を許可。425重複応答は既存レポートIDで進捗を確認する。結果不明・プロフィール切替には照合/移行確認が必要で、強制リセット機能はない。
- CSV/手入力のAmazon期間と重なるAPI行は集計から除外し件数を警告する。手入力記録を削除しない。全キャンペーンと部分入力を安全に判別できないため保守的に期間全体を優先する。
- デザインは黒いブランドナビゲーション、明るい作業面、青い主操作、淡い緑の議事録、琥珀色の注意を使用。説明折りたたみを維持し、未接続/エラー/招待確認は表示する。

## 外部連携の未完了事項と必要承認

|対象|確認したこと|必要な次の判断・操作|
|---|---|---|
|Notta|指定ワークスペースはPremium表示・1,800分枠。2026-10-28再確認ではGoogle Calendar接続済み、Zoom未接続。ZapierはBusiness表示。公開の直接API/webhook利用資格は確認できていない|公式提供経路・プラン差額・利用条件を確認後、対象録音/議事録・宛先・保持期間と参加者告知/同意を決めて承認。Businessへの変更、Zapier永続アクセス、Zoom/Calendar接続は未実行|
|Amazon Ads|SP-APIと独立したDeveloperアクセス申請・LwA認可・広告profileが必要。実広告アカウントと利用資格は未検証|対象広告アカウント、JP profile、SPのみで足りるか確認後、アプリ認可と以下の秘密値登録を別承認。広告配信/予算変更は不要・未実装|
|Google|既存の主催者照合・再認可警告を維持|本人の認可完了待ち。警告回避や追加スコープ変更をしない|

将来のAds設定名は `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET`, `AMAZON_ADS_REFRESH_TOKEN`, `AMAZON_ADS_PROFILE_ID`。値は既存の秘密情報管理手順で登録する。`AMAZON_ADS_SYNC_ENABLED=true` の明示設定まで定期同期は無効。既存Cronの09:10 / 20:00 / 22:00 JSTで進捗確認する設計で、新Cronは追加していない。有効化前に既存通知/SP同期とのWorkers Freeサブリクエスト・CPU・保存容量枠を実アカウント件数で検証する。上限を超える場合は有効化せず設計変更する。既存通知を先行させる。

API自体の追加料金はないとの公式案内だが、広告費、Notta/Zapier契約、Cloudflareの利用枠は別。追加課金は行っていない。Amazon権限が読み取りだけとは保証しない（アプリ実装はprofile/レポート取得のみ）。

## 公式資料（2026-10-23調査）

- https://www.notta.ai/en/integrations
- https://support.notta.ai/hc/en-us/articles/28179083843611-How-to-integrate-Zapier-with-Notta （Business/Enterprise）
- https://www.notta.ai/en/pricing
- https://advertising.amazon.com/about-api
- https://advertising.amazon.com/API/docs/en-us/guides/onboarding/apply-for-access
- https://advertising.amazon.com/API/docs/en-us/guides/account-management/authorization/overview
- https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/columns
- https://advertising.amazon.com/API/docs/en-us/guides/reporting/v3/report-types/advertised-product

Reporting v3は公式に2027-06-30廃止予定が案内されている。実接続承認時に最新のReporting v1移行要件を再確認し、移行検証する。このモック実装を実アカウントで検証済みと扱わない。

## 検証

架空データのみのモックで種別ガード、URL保全、同意必須、厳密抽出/曖昧性/既存値競合、重複/更新競合、取消、APIレポート生成/取得/遅延更新/プロフィール切替/未知結果停止を検証。実会議/録音/招待/広告配信は実行しない。
PCと390pxのスマホ相当表示で、OEM選択・種別・内容/日時/所要時間保存・戻る・Zoom URL自動入力・Calendar招待先確認・議事録保存と根拠表示・再読込をモックで確認。その他種別ではZoomを作成しない。数値反映取消のブラウザ確認はダイアログ操作の応答待ちとなったため未確定（ローカルAPI回帰テストでは取消・後続編集競合を確認）。実サービスの認可・録音・招待は未実行。
