> **初回試作の履歴資料です。** 永続化・照合・基点・検証結果の最新版は [ローカル安全基盤](amazon-fulfillment-durable.md) を参照してください。以下の未実装項目には、その後実装済みになったものがあります。

# Amazon 自社発送: ローカル実装・引継ぎ

2026-10-25。**実データ機能は無効。実注文で使えません。**

## 作業場所と対象

独立コピー `sickstyle-amazon-local`、作業ブランチ `local/amazon-fulfillment`、基点 `326676518f68966be10cae6a1533a5d53bf74b0d`。既知checkoutは読み取りのみ。`git ls-remote` で main は `7d07fd4e7b16a9b65e12e9ac00a5a3091d8c6f8e`、remote HEAD は `7355924da7e7f3ba41536ea8d191ddce73b371f6` と確認。mainにはアプリがないため、既知アプリSHAを基点にした。PR71の本番SHA `357c39db3c493f5b123b5812e02293b87bd0af38` の変更は取り込んでいない。将来適用する場合はリリース担当と基点を再確認し、この機能の差分のみを移植する。

AGENTS.mdを読み、実装範囲をユーザー指定のローカル・合成データに限定した。基点リポジトリに `.agents/skills` / 追加SKILL.mdは存在しない。外部Claude、push/Issue/PR/merge/deploy、Amazon認可・Secrets・本番DB変更は未実施。

## 実装済み

- 本体 `/api/amazon/fulfillment` 以下は未認証401、既存セッションでも403。ヘッダー/bodyのadmin・MFA申告や環境変数で解除できない。Amazon画面に未有効化理由を表示。
- `local/amazon-fulfillment` は本番public/Workersから独立。ループバック専用サーバー、Host/Originチェック、HttpOnly/SameSite Strictセッション。トークンはプロセス起動時の合成検証用。**実MFAの代替ではない**。
- 合成注文一覧、必要時の合成配送先表示、配送会社・追跡番号・商品ID/数量・発送日時のプレビュー、チェックと明示ボタンによる模擬通知。
- 住所は一覧・journal・監査・AI入力・一般キャッシュへ入れない。HTTP no-store。DOMは60秒、閉じる、画面非表示、ログアウトで消去。遅い応答は画面世代を照合して別注文へ混入させない。
- 部分発送は未割当数量まで。荷物IDはサーバーで注文内正数文字列として事前固定し、複数荷物は別ID。クライアント指定IDは不採用。
- 5分でプレビュー失効。確認直前に数量を再検証。二重クリック・再読込は同じ状態を返し、模擬dispatchを増やさない。
- `PREVIEW → SUBMITTING → ACCEPTED / UNKNOWN / REJECTED`。予約を合成journalへ書いた後に模擬dispatch。再起動時SUBMITTINGはUNKNOWN。UNKNOWNは自動再送も新IDによる追加も禁止。
- API受付と注文の発送済み表示を分離。合成の照合はACCEPTEDをVERIFIEDにするだけで注文statusを改変しない。UNKNOWNの照合は解決できず停止を維持。
- PENDING/CANCELLED/SHIPPED/FBA/Ship+/Buy Shipping/代引は対象外。代引・Transparency商品・特殊出荷元などは別設計が必要。

## ローカル起動

```sh
cd /Users/kusakatakuma/Documents/Codex/2026-10-25/task-2/sickstyle-amazon-local
node local/amazon-fulfillment/server.js
```

出力された `127.0.0.1` URLを開き、同時に出たデモトークンでログイン。実認証情報は使わない。追跡番号は `DEMO-123456` のような合成形式のみ。実配送会社コードへの変換は未実装。サーバーは.envを読まず、Amazonクライアント/HTTP送信アダプターを持たない。停止は起動端末のCtrl-C。

`.local-amazon-demo/synthetic-journal.json` は合成データのみでgit対象外。単一プロセスのデモ保存であり、分散ロック・fsync/障害復旧・本番暗号化・保持期限の保証はない。実データ用に再利用しない。

## 検証

- `npm run build`: PASS。
- `npm test`: **387/387 PASS**。Cloudflare `wrangler deploy --dry-run` のアップロードなしビルドを含む。
- `tests/amazon-shipping-demo.test.js`: **12/12 PASS**。staff/MFAなし/別admin拒否、全本体routeの401/403とoutbound=0、PII不在、フィールド/数量検証、部分発送/複数荷物、二重confirm、競合プレビュー、UNKNOWN/restart、書込失敗、失効、loopback認証/Origin/Host/logout。
- 既存 `tests/amazon-fulfillment.test.js`、非PII同期・staffOnly AI・マクサスの実装は変更なし。
- 独立内部レビュー: `docs/amazon-fulfillment-review.md`。初回2指摘（誤画面挿入・遅延住所混入）を修正し再レビュー。住所応答の注文切替/閉じる回帰3件PASS。
- PC 1280×900: ログイン、住所取得、数量1のプレビュー、確認前ボタン無効、確認後API受付表示、注文はUNSHIPPEDのままを確認。
- スマホ 390×844: 再読込後の受付状態保持、2荷物目の固定ID、タイムアウトUNKNOWN/再送ボタンなし、横はみ出しなしを確認。画像 `amazon-fulfillment-qa/`。
- 初回sandbox内のHTTPテストはNode native assertionで失敗。loopbackを許可された実行で再実行し12/12、全体387/387通過。依存の相対symlink不整合も独立コピー内だけで修正。テスト未実施を成功扱いしていない。

## 公式仕様の確認（2026-10-25）

1. [Access Orders PII](https://developer-docs.amazon/sp-api/docs/access-orders-pii): 日本FBMのrestricted住所にはDirect-to-Consumer Shipping (Restricted)。v2026-01-01はRDT不要。必要時 `getOrder` の `RECIPIENT`、買主メールなど不要な情報を要求しない。
2. [Confirm shipment](https://developer-docs.amazon/sp-api/docs/confirm-the-shipment-status) と [API reference](https://developer-docs.amazon/sp-api/reference/confirmshipment): 読取v2026とは別に `POST /orders/v0/orders/{orderId}/shipmentConfirmation`、成功204。Inventory and Order Tracking または Direct-to-Consumer Shipping (Restricted)。Ship+は対象外、Buy Shipping等ですでに自動確認される注文は手動通知不要。
3. [公式Orders v0 model](https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/orders-api-model/ordersV0.json): marketplaceId/packageDetail、正数文字列packageReferenceId、carrierCode/trackingNumber/shipDate/orderItemsが必須。複数荷物は別ID。同IDは編集にも利用されるため、万能な冪等性キーとはみなさない。
4. [Amazon security control guidance](https://developer-docs.amazon.com/sp-api/docs/guidance-to-address-key-security-controls-in-sp-api-integration): 個人別ID、最小権限/MFA、暗号化と鍵管理、保持削除、PIIを含めないセキュリティ監査等。実運用前に最新DPP全文と適用条件を責任者が確認する。ガイドのPII削除期限・ログ保持期間を満たす実装/証跡が未確認のため停止を維持。

## 実運用前の必須条件（未完了）

1. **権限**: 対象seller/JP marketplace、開発者・アプリ双方の住所restricted role grant、通知role grantとseller authorizationを確認。未承認/不明/403は有効化不可。申請・OAuth変更は別の明示承認が必要。
2. **個人別管理者とMFA**: 共有セッションをPII認可に流用しない。サーバーで個別principal・admin権限・MFA/期限/失効を検証し、閲覧/送信権限の利用者名簿と責任者を確定。
3. **DPP**: TLS、DB/バックアップ/端末の暗号化とKMS、鍵更新、最小限の住所だけの短期処理、配送後30日以内を上限とする適用保持方針/削除および認可解除等の削除トリガー、バックアップを含む削除検証、PIIなし監査の保護・最低12か月保持などを設計・審査。既存設定は勝手に変更しない。
4. **実adapter・outbox**: seller/order/packageスコープのunique制約、トランザクションで数量確保/確認済payload/固定ID/試行状態を保存、分散競合制御、永続化失敗時は送信しない。PII/追跡番号を一般ログやAIへ渡さない。未知のAmazonフィールドを全文保存しない。
5. **照合**: タイムアウト/接続断/応答読取失敗はUNKNOWN。v2026 PACKAGES/FULFILLMENTを別途取得し、seller/order、固定package ID、carrier/tracking、商品ID/数量等を照合。欠落・不一致・古い読取は未解決のまま。結果不明時に新IDや無条件再送をしない。遅延反映/編集/外部操作との競合ルール、手動エスカレーション担当を確定。
6. **ユーザー確認**: 使用する配送会社と公式JP carrierCode、追跡番号/発送日時の業務ルール、部分発送・複数荷物の単位、発送担当者、代引/Transparency/特別出荷元の対象外扱い、誰が不明結果を調査するか。ラベル購入・集荷予約は範囲外。
7. **別途承認**: 実アカウント読取、権限/認証変更、セキュリティ設定、テスト対象注文、外部公開、本番反映の許可をそれぞれ得てから実施。今回の合成検証はそれらへの許可ではない。

未実装: 実住所API adapter、実通知adapter、個人別MFA、実Amazon照合、分散永続outbox。本番機能の完成ではなく、安全な非稼働scaffoldまでの完了。
