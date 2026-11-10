# SICK STYLE PR #4 本番反映の実行条件

## 今回の保存容量P2

成果物を依頼とレビュー履歴へ二重に保存し、取込後に採用・差し戻しの追加容量が足りなくなる問題を修正した。DBの内部JSONはv2とし、成果物を内容ハッシュで参照する。APIとAI社員バックアップは従来のv1形式の完全な成果物・履歴を返す。v1を読むだけではDBを書き換えず、次の本人操作時にCAS付きトランザクションで保存する。D1のテーブルは変更しない。

新規依頼・取込・再開を受理する前に、レビュー待ち全件に対する最大1000文字（JSONエスケープで最大6バイト/UTF-16単位）の理由、両方の判断記録、履歴、監査と停止の容量・監査枠を確保する。予約不足なら新規操作を拒否し、既存レビューと停止を優先する。

旧形式ですでに予約不足のデータは、既存`ss_documents`内の内容ハッシュ付き分割片へ退避してレビューを続けられる。全体4MBの範囲で、各行を750KB未満とし、断片・全体の完全性を検証する。旧履歴・古い成果物・監査は削除しない。旧断片も自動削除しない。D1全体の空き容量やサービスの利用枠枯渇は別途確認が必要。

## 本番反映を止める条件

- 最新HEAD/比較元の独立Codexレビューがない、またはP0/P1/P2の記載がある。
- 最新SHAのCI、Secrets検査、PC/iPhone確認が未完了。
- 本人のCloudflareログイン・対象アカウント/Worker/D1を確認できない。
- Free・追加課金0円を本人が確認できない。
- 現在Version・復旧手順・DBバックアップ・ローカル復元を確認できない。
- 旧Versionと新しいAI保存形式の互換性・AI停止時の復旧方針が未確認。
- 事前確認が1時間を過ぎた、SHA・レビュー・バックアップ・本番Versionが変わった。

確認できない項目は「未確認」とする。チェックを満たすためのSecret登録、課金契約、投稿、マージ、DB削除は行わない。

## Macでの手順

利用者のSICK STYLEチェックアウトで最新ブランチを取得し、最新HEADをレビューする。`npm run deploy`は今回から計画のみ。旧Secret登録・DBマイグレーションを含む方式を呼ばない。

```bash
git pull --ff-only origin ai-staff/phase4-runtime
npm test
npm run build
npm run deploy
npm run deploy -- --dry-run
npm run ai:review -- --base origin/claude/initial-github-sync
```

レビュー本文を読み、指摘があれば修正・再テスト・再レビューする。問題が解決した後、本人が次を実行する。

```bash
npx --no-install wrangler login
npm run deploy:preflight
```

事前確認は本番コードを変更しない。本人の事実確認、現在のVersion配分の取得、D1全体の読み取りエクスポート、ローカルSQLiteへの復元と完全性確認、復旧コマンドの記録を行う。SQLには秘密情報や業務情報が含まれるため、`data/deployment-backups/`は私有とし、チャットやGitHubへ送らない。

Secrets/Variables・DBスキーマ・Cron・ルートの保持はコード専用Version方式と本人の設定点検で確認する。Cloudflare側の設定値の自動差分検査までは実装していない。未確認ならNで止める。古いWorkerがv2/分割形式を扱えない場合は、コードRollbackだけではAI機能が戻らない。旧Versionの実体と、AI停止・データ保全・復旧方針を先に確認する。

1時間以内に同じSHAの事前確認を満たす場合だけ実行する。

```bash
npm run deploy -- --apply
```

テスト・build・コード専用dry-run・Versionアップロードを行い、SHAと本番配分が変わっていないことを再確認して切り替える。反映後Versionは`data/deploy-readiness/<SHA>-deployed.json`へ保存する。公開ファイル・未認証APIの読取検証後、本人ログインしてAI社員の保存・取込・採用・差し戻し・停止を確認する。

## 問題時の復旧

新しい操作を停止し、`data/deployment-backups/<SHA-UUID>/previous-versions.json`と`rollback.json`を確認する。Rollbackは記録した全Versionと配分を`wrangler versions deploy`へ戻すコード操作。自動では実行しない。DBは書き戻さず、秘密値を変更しない。

AI保存形式が旧Versionと互換でない場合はAIを停止したまま保全する。復旧前後のバックアップを確保し、本人と選択的な復元・修正版への復帰を判断する。SQL全体を無断で本番へインポートしない。ローカルのSQL復元成功は、本番への復元を実施したという意味ではない。

本クラウドで本人認証・バックアップが未確認なら、Versionを推測して復旧コマンドを作らず「本番未反映・事前確認待ち」と報告する。
