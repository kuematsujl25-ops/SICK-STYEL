# Amazon 自社発送 scaffold 独立内部レビュー

実施日: 2026-10-25（UTC）

対象: `local/amazon-fulfillment/`、`lib/amazon-fulfillment-gate.js`、`api/index.js` / `public/app.js` の今回差分、`tests/amazon-shipping-demo.test.js`。

実装担当とは別の Codex 子エージェントがレビュー。外部 Claude、Amazon実API、実PII、実注文、既存リリースcheckout、本番DBは使用していない。これはローカル合成専用scaffoldの内部レビューであり、リポジトリの `npm run ai:review` リリース審査や本番セキュリティ承認を代替しない。

## 指摘と修正確認

1. Amazon準備中パネルが `instagramView()` に入っていた。修正後のdiffで `amazonView()` のみに変更があることを確認した。
2. 注文Aの住所取得中に閉じて注文Bを開くと、遅れて届いたAの住所がBのダイアログへ表示された。Node VM + DOM/fetch stubで再現。修正後、画面世代の照合により以下3点が成功した。
   - 遅いA応答はBの住所欄へ入らない。
   - 現在のB応答はBの住所欄へ表示される。
   - close後に届く住所応答は破棄される。

上記2件は解消済み。ローカル合成専用という範囲で、未解決の重大な誤送信・実PII取得経路は見つからなかった。

## 独立検証結果

`node --test tests/amazon-shipping-demo.test.js`: **12 / 12 PASS**。

通常sandboxではloopback HTTPテスト開始時にNode v24.18.0のnative assertion (`execution_async_id()==0`) が発生した。loopback単独でも再現し、承認されたローカルテスト実行（sandbox外）では全12件成功した。アプリテストのassertion失敗ではなかった。

確認した項目:

- 本体APIは未認証401、既存共有セッションも403。環境変数・偽造role/MFA入力で解除されない。外向きfetch回数0。
- 合成サービスは管理者IDとMFAのサーバー側判定が必要。非管理者・MFAなしは拒否。別管理者の確認待ち荷物の操作も拒否。
- 住所は一覧・journal・監査ログに含まれない。返却オブジェクトによる内部状態改変も不可。
- 部分発送、複数荷物の数量予約、サーバー発行の荷物番号、二重クリック、再読込、競合確認、期限切れを検証。
- UNKNOWNは再起動後も保持し、新規荷物・無条件再送を禁止。SUBMITTINGからの復旧はUNKNOWN。
- API受付と荷物照合済みを分離し、注文状態を受付のみでSHIPPEDにしない。
- localhost Host制限、same-origin確認、Cookie認証、no-store、ログアウト後の古いCookie拒否。

## 実運用の審査が別途必要な範囲

デモのMFAは固定した合成principalであり、実MFAではない。合成JSON journalは本番用トランザクションoutbox・複数インスタンス排他・暗号化保存を提供しない。合成の照合結果も実Amazon PACKAGES/FULFILLMENT照合ではない。実通信アダプターは存在しない。

個人別ID/MFA、実grant、暗号化と鍵管理、保持/削除、監査、永続トランザクションと照合・手動解決が別途実装・承認されるまで、本体のハードブロックを解除してはならない。本レビューはそれらの承認ではない。
