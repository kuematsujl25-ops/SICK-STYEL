# 月額0円の公開構成（Cloudflare Workers Free + D1）

2026-10-17 に Cloudflare 公式ドキュメントで再確認。標準の `*.workers.dev` URL（無料HTTPS）を使用し、Vercel Pro・Workers Paid・有料トライアル・独自ドメインは契約しません。

## 選定理由

| 候補 | 判断 |
| --- | --- |
| **Workers Free + D1（採用）** | 既存コードがWorkers＋D1対応済み。静的ファイル配信は無料・無制限、D1は同じアカウントで追加認可不要。上限到達時はエラーで止まり、自動でPaidに切り替わらない。 |
| Pages Functions + D1 | 同じ無料枠だが、関数ルーティングとCronの再構成が必要。 |
| Vercel Hobby | 規約上、商用利用不可のため不採用。 |
| Workers + Neon Free | 別サービスのアカウント・接続文字列が増えるため不採用。 |

データはすべてD1（Cloudflareのデータベース）に保存し、サーバーのローカルファイルには保存しません。PCを閉じてもスマホ・別PCから利用できます。

## 公開手順（本人がMacの「ターミナル」で1コマンド）

```sh
cd ~/Sites/SICK-STYEL
npm run cloud:setup
```

スクリプトが順に行うこと:

1. Cloudflareログイン（ブラウザーが開くので本人がログイン／無料登録し「Allow」）。カード登録は不要。
2. Workersに有料契約がないことをAPIで確認（読めない場合はダッシュボードを本人が確認して y を入力）。有料契約があれば停止。
3. `wrangler.jsonc` にアカウントIDを設定。
4. D1 `sickstyle-db` を作成（既存なら再利用・上書きなし）。
5. workers.dev サブドメインを確認（未登録なら名前を入力）。公開URLを `APP_ORIGIN` に設定。
6. `npm test` → スキーマ作成 → デプロイ → 本番用の秘密値（ローカルとは別に生成）をSecretsへ登録。値は表示しません。
7. 管理者作成（`npm run admin:create:remote` と同じ）。
8. 任意で公開URLの動作確認（`npm run verify:deployment`）。

再デプロイは `npm run deploy`（無料プラン確認の記録が24時間以内である必要があります。古い場合は `npm run cloud:setup` を再実行）。

## 無料枠の上限と、上限時の動作

| 項目 | 無料枠（アカウント全体） | 上限に達すると |
| --- | --- | --- |
| Workersリクエスト | 100,000回/日（静的ファイルは対象外・無制限） | エラー1027で拒否。00:00 UTC（日本時間09:00）にリセット |
| CPU時間 | 1リクエスト10ms（通信待ちは含まない） | エラー1102。ログイン時のパスワード検証が最も重い処理です |
| 外部サブリクエスト | 1回50件 | Instagram同期は最新25投稿、Amazonは最大7件に制限。Cronはサービス別に分割 |
| D1 読み取り / 書き込み | 500万行/日・10万行/日 | クエリーがエラー（データは残る）。00:00 UTCにリセット |
| D1 容量 | 合計5GB（1DB最大500MB） | 書き込み不可（削除まで） |
| D1 1行 | 最大2MB | 業務データは1行のJSONのため、大量登録時は先にこの上限に達します |

**課金されない理由**: 上限時は課金ではなくエラーで停止します。Paidへの切替は本人がダッシュボードで明示的に購入しない限り発生せず、本アプリのスクリプトは支払い・プラン変更APIを呼びません。ダッシュボードでWorkers Paidを購入しないでください。

その他: Time Travel（D1の復元）はFreeで7日。設定画面からJSONバックアップを定期的に保存してください。`MAINTENANCE_MODE=true` でAPIを止められます。

## 公式資料

- [Workers 料金](https://developers.cloudflare.com/workers/platform/pricing/) / [Workers 上限](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 料金](https://developers.cloudflare.com/d1/platform/pricing/) / [D1 上限](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare セルフサービス規約](https://www.cloudflare.com/terms/)
