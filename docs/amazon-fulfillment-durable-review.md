# Amazon 自社発送：永続 outbox の独立内部レビュー

日付: 2026-10-25 UTC

対象: `local/amazon-fulfillment/{service,store,reconciliation,server,app}.js`、`tests/amazon-shipping-demo.test.js`、`tests/fixtures/amazon-outbox-child.js`。実装担当とは別のCodex子エージェントがコードレビュー、再現検証、修正後の回帰検証を実施した。独立checkoutのアプリ基点はPR #71を含む `357c39db3c493f5b123b5812e02293b87bd0af38`。既存リリースcheckoutには触れていない。

レビュー範囲はローカル合成データ専用。Amazon実通信、実PII、ブラウザー操作・ブラウザーログイン、外部Claude、本番設定変更は実施していない。`npm run ai:review` のリリース審査や本番セキュリティ承認を代替しない。

## 指摘と解消

### 1. 対象荷物が一致しない場合の外部発送見落とし

修正前は、対象荷物の照合がMATCHする前に戻っていた。ACCEPTEDの荷物1個に対し、fresh/completeかつ注文SHIPPED、対象referenceなし、外部referenceの数量3という証拠を渡しても、注文はUNSHIPPED・eligible=trueのままで新たな数量2の通知を模擬できた。独立した小さな合成実行で再現した。

修正後は、注文・seller・marketplace・取得時刻・完全性のスコープ検査を先に行い、対象欠落、同referenceの内容不一致、外部荷物、発送不可の注文状態を注文全体のブロックへ反映する。対象不一致を成功や再送許可と扱わない。回帰テスト4パターンを確認し、指摘は解消済み。

### 2. WAL読み取り中に物理消去を成功扱いする問題

修正前は `wal_checkpoint(TRUNCATE)` のbusy結果を無視していた。別SQLite接続が読み取りトランザクションを保持すると、30日経過のmaintenanceは削除成功を返す一方で、WALには追跡番号の文字列が残った。readerを解放して再実行してもremoved=0のため再消去されなかった。実データを含まない一時DBで再現し、検証後に破棄した。

修正後は論理削除と物理消去完了を分離し、削除世代・完了世代をDBへ永続化する。busyなら `erasurePending=true` を返し、新たな削除が0件でも再試行する。チェックポイント後に別削除が競合しても、世代が一致する場合のみ完了へ進む。別reader保持・別serviceでのpending復元・reader解放後の再試行・DB/WALのraw bytesからの追跡番号消失を回帰テストで確認した。指摘は解消済み。

## 独立実行の結果

`node --test tests/amazon-shipping-demo.test.js`: **25 / 25 PASS、失敗0**。

通常sandboxではloopback時にNode v24のnative assertionが発生する既知の実行制約があるため、承認されたsandbox外のローカルテスト実行で検証した。これはブラウザー再試行ではなく、一時DBとloopback HTTPを使用する自動テストである。

確認した主要な性質:

- BEGIN IMMEDIATE、unique制約、単一試行制約により、複数の独立子プロセスから同じ荷物を確認しても試行1回・荷物番号1個を保持する。
- 異なる荷物の競合は数量を過剰予約できず、同一追跡番号の同時作成も拒否する。
- enqueue失敗はトランザクションをrollbackし、数量予約・outbox・送信試行が半端に残らない。
- claimは模擬副作用前にcommitする。別プロセス終了・受付結果保存失敗後は予約を保持し、lease期限後UNKNOWNへ進めるが再claimしない。
- UNKNOWN、削除済み、認可失効は再起動しても再送許可へ変わらない。
- 照合はsource/seller/order/marketplace、PACKAGES/FULFILLMENT、完全性・時刻、荷物番号・配送会社・追跡番号・日時・商品数量の一致を必要とする。無関係なbuyer属性を保存しない。
- 30日の合成payload削除、最小限の再送防止tombstone、400日の監査保持、失効時削除を検証。削除済み注文は再送不可。
- 本体APIのハードブロックは維持。未認証401・共有セッション403で、環境変数や偽role/MFA入力による解除はなく、外向きfetchは0。

## 結論と適用限界

指摘した2件は修正と回帰検証を確認した。現時点のローカル合成専用scaffoldに関して、未解決の重大な誤送信・実PII取得経路は確認されなかった。

SQLiteはローカルプロセス間の競合を検証するためのものであり、Cloudflare D1の本番実装・分散実行の承認ではない。保持削除はサービス呼び出し/maintenance時に実施され、放置中も期限どおり実行する本番スケジューラはない。DB/WAL以外のバックアップ・ディスクスナップショット・旧JSON journalの廃棄は別途管理が必要。個人別ID/MFA、実grant確認、暗号化/KMS、監査保護、実Amazon adapterと照合・運用上の手動解決は未承認のままであり、本体gate解除の根拠にはならない。

## 最終小差分の追加レビュー

以下の最終変更をコードとローカル状態で確認した。追加の重大指摘はない。

- `erasurePending` は単一SQLで削除世代と完了世代を比較するため、異なる読取時点の値を混在させない。
- 400日を超えた監査行の削除も `removedAudit` として数え、削除世代の更新と物理消去再試行の対象に含める。
- 子プロセスの `claim-and-crash` はclaimのcommit後に `SIGKILL` で終了し、通常のDB closeは通らない。親テストは終了signalが `SIGKILL` であること、lease期限後UNKNOWN、試行回数1、再claim不可を確認する。
- 作業場所の旧 `.local-amazon-demo/synthetic-journal.json` が存在しないことを読み取り確認した。旧合成JSONに関する残存懸念は解消済み。将来のバックアップ・スナップショットの削除方針は引き続き別途必要。

実装担当から、これらの差分を含む全体回帰 **404 tests PASS** と **build PASS** の報告を受領した。この全体回帰は実装担当の実行結果であり、本レビュー担当が独立実行した25テストの結果とは区別する。
