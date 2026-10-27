# Amazon 自社発送 — 検証済みローカル安全基盤

2026-10-25。実Amazon通信・実PII・本番設定変更・公開は行わない。SPPは本人ログイン待ちであり、ブラウザーの再試行もしていない。

## 基点・保全

- 独立checkout: `/Users/kusakatakuma/Documents/Codex/2026-10-25/task-2/sickstyle-amazon-local`、`local/amazon-fulfillment`。
- read-only `ls-remote` 比較: main=`7d07fd4e7b16a9b65e12e9ac00a5a3091d8c6f8e`（アプリなし）、実アプリブランチ `ai-staff/phase4-runtime`=`357c39db3c493f5b123b5812e02293b87bd0af38`。remote HEADは`7355924`。
- 独立checkoutだけに最新アプリブランチをfetch。初回作業をstash保全→`3266765`から`357c39d`へfast-forward→stash復元。競合なし。PR71の期限超過通知・テスト・build変更を保持した。
- 元checkout・既存プロセス・PR・本番配信には触れていない。将来統合前には**357c39d以降を含む最新main/実際の統合先との整合を再確認**する。今回はpush/PR/merge公開/deployをしていない（ローカルfast-forwardのみ）。

## 実装済みの安全基盤

`local/amazon-fulfillment/store.js` はNode標準SQLite、WAL、synchronous=FULL、foreign_keys、BEGIN IMMEDIATEを使用する。DBはローカルの `synthetic-outbox.sqlite` のみ。.env、DATABASE_URL、D1本番設定は読まない。

| 処理 | 実装した保証・限界 |
| --- | --- |
| プレビュー | 検証済みフィールドのみ保存。注文内連番をトランザクションで採番、荷物UUID・固定payload/digestと5分の確認期限を保持。order/referenceとorder/tracking hashをDBのunique制約で保護 |
| 確認 | 明示ack、サーバー認可、注文適格性・残数量を同一トランザクション内で再確認し、数量予約とoutbox QUEUEDを原子的にcommit |
| 送信予約 | QUEUEDかつattempts=0だけをclaim。試行ID・lease・attempts=1をcommitした後に模擬結果を扱う。別プロセスが同時確定しても一度だけclaim |
| 再起動 | QUEUEDは固定payloadで明示操作から再開可能。IN_FLIGHTは有効lease中に奪わず、期限切れでUNKNOWN。UNKNOWNは再claim・新IDによる回避を禁止 |
| 応答不明 | タイムアウト、lease切れ、受付結果の保存失敗は数量を保持。自動再送なし。遅い応答がUNKNOWNを上書きしない |
| 部分・複数荷物 | 商品ID/数量を別テーブルに保持。QUEUED/SUBMITTING/UNKNOWN/ACCEPTED/VERIFIEDを予約として集計し、残数超過を禁止。荷物は別reference |
| 照合 | 正規化されたPACKAGES/FULFILLMENTインターフェースを実装。seller/marketplace/order、complete、取得時刻、固定reference、carrier、tracking、発送日時、商品ID/数量の完全一致を確認。未一致・対象欠落・外部荷物・注文状態矛盾は停止。古い/不完全/別scopeの証拠は成功扱いしない |
| 状態表示 | 204模擬受付はACCEPTED。VERIFIEDは荷物証拠一致の別状態。注文状態は受付だけでは変更せず、適格な照合結果があった場合だけ観測値として保持。SHIPPED/CANCELLED/PENDINGの観測は注文を停止し、対象荷物一致を意味しない |
| 監査 | 固定eventコード、本人IDのhash、ランダム荷物ID、時刻のみ。住所・追跡番号・payload・任意エラーメッセージ・原文レスポンスを保存しない。生の管理者IDも監査へ含めない |
| 削除 | payloadは作成から30日で論理削除。監査は400日後に削除。住所は最初からDBへ保存しない。認可失効シミュレーションは即時に全payload/数量を削除し以後のアクセスを拒否。重複送信防止用の最小tombstoneは残し対象注文を停止 |
| 物理消去 | secure_delete＋WAL checkpoint/VACUUM。readerが旧WALを保持する場合は消去完了とせず永続erasure_generation/completedでpendingを保持。後続maintenanceで、論理削除0件でも再試行。並行purgeを古い完了結果で消さない |

状態管理はテスト用の見た目だけではなく、SQLite・複数プロセス・障害注入で検証した実装である。ただしdispatchの成功/拒否/タイムアウト結果と、画面の管理者principal・MFA・住所・注文・照合データは**合成**である。実SP-API adapterは存在しない。

## 照合インターフェースの境界

`reconciliation.js` の正規化DTOはAmazonの実レスポンスそのものではない。将来のv2026 adapterはPACKAGES/FULFILLMENTからallowlistで明示マッピングし、販売者・完全性・観測時刻をサーバーで付与する必要がある。今回のsourceは `synthetic-v2026` しか受理せず、実通信への接続口はない。

HTTP reconcileエンドポイントはクライアントbodyの証拠を採用しない。既定の合成providerはローカルACCEPTED/VERIFIEDのみ観測し、UNKNOWNを自動的に成功へ変えない。unit/integration testsは正しい・不正・欠落した証拠を直接注入する。信頼できる完全な証拠でも矛盾があればorderを隔離し、解除APIは設けない。実運用の手動解決担当・判断基準は未確定。

## 保持削除の境界

ローカルでは各認可操作前、および明示 `service.maintenance(admin)` で期限処理を実行する。常駐runnerや本番スケジューラーは追加しない。停止中/未使用時にも期限を保証する本番定期実行、バックアップ・OSスナップショット・コピーの削除、KMS/端末暗号化、tombstoneの許容保持期間は未実装・未承認。単一ローカルDBでraw bytes消去を検証しても、保存環境全体のDPP適合を意味しない。

旧 `synthetic-journal.json` は移行しない。今回自分で作成した旧合成journalは削除済み。過去のデモコピーが別にある場合は別途管理が必要。

## ローカル実行

```sh
node local/amazon-fulfillment/server.js
```

`127.0.0.1`だけにbindし、デモトークンでログインする。実資格情報は使用しない。合成tracking `DEMO-123456`、合成carrier `DEMO-YAMATO`等のみ。公開Workerにこのローカルサーバーを組み込まない。本体 `/api/amazon/fulfillment` は401/403のハードブロックを維持し、環境変数から解除できない。

## 最終検証・レビュー

- 新規合成テスト: `tests/amazon-shipping-demo.test.js`。並行子プロセスの二重確定/数量競合/追跡重複、claim直後SIGKILL、再起動、部分/複数荷物、権限拒否、UNKNOWN、照合不一致、DBトランザクション失敗・応答保存失敗、保持/認可失効、WAL readerの消去pendingと再試行。
- 最終 `npm test`: **404/404 PASS**（新規安全基盤25件＋既存回帰、PR71を含む）。`npm run build`: PASS、Cloudflare dry-run: PASS、差分check: PASS。
- 最終全体結果は `amazon-fulfillment-qa/durable-test-output.txt`、buildは `durable-build-output.txt`。
- 独立最終レビューは `amazon-fulfillment-durable-review.md`。初回の『対象荷物欠落時に注文全体の矛盾を無視』『busy WALを物理消去成功扱い』を修正し回帰テスト追加。
- 初回PC/スマホQA画像は前段のJSON版のもの。今回の更新はブラウザーを再操作せず、HTTP統合・状態管理・ビルド検証を実施した。新SQLite版のブラウザー再QAは未実施と区別する。

## 実稼働に残る必須条件（ユーザー確認待ち）

1. SPP本人ログイン後に実アプリID、住所restricted role、発送通知role、登録ユースケースを確認。現在のgrantは不明。申請・再認可は別承認。
2. 単一の本人専用管理者を確定し、本番セッションの本人ID/MFA検証、失効・復旧・再認証を実装/設定。固定した合成MFAは実認証ではない。担当者追加は不要。
3. DPPに従う最小権限、TLS、鍵管理・暗号化、端末/バックアップ保護、監査保護と保持/全コピー削除、期限処理の稼働保証を承認・検証。
4. 本番D1向け原子的SQL/競合制御へ移植し、その実行環境でoutbox/再起動/障害を再検証。今回のSQLiteは同一ローカルDBを複数プロセスで使う保証であり、Workers/D1分散実行の検証ではない。
5. 実v2026読取・正規化・実v0通知adapter、JP配送会社コード、発送日時/部分発送ルール、代引/Transparency等の対象外、結果不明・外部編集の調査手順を確定。ラベル購入・集荷予約は範囲外。
6. 実データ読取/通知テストと公開の明示許可を得る。これらが揃うまで本体gateを解除しない。
