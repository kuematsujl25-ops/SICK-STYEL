# 公開サイト（sickstyle-site）との連携

2026-10-17 時点の調査結果と実装状況。

## 現在のサイト（https://sickstyle-site.vercel.app/ ＝ sickstyle.net）
- Vercelでホストされた1ページ構成（Next.js App Router と推定。ソース未確認）。
- セクション: Hero / Product（Black・Silver・Gold Shin Guard）/ Philosophy（起源・Mission・Vision・Values）/ Athletes（準備中）/ Where to Buy / Follow / Footer。お知らせ欄はなし。
- **注文・カート・問い合わせフォームはなし。** 購入は Amazon と自社EC（shop.sickstyle.net＝BASE）へのリンク。卸・選手の問い合わせは Instagram DM。
- 商品画像はサイト内の `/products/*.jpg`。

## 管理アプリ側で実装済み（このリポジトリ）
- 「サイト掲載」画面: 商品・お知らせ・ブランド理念・購入先リンクを編集（下書き）。
- 「公開」タブで公開中の内容との差分を表示 → 確認して公開。1つ前の公開内容に戻す機能あり。
- 公開用API `GET /api/public/site`（認証不要・読み取り専用・CORSは許可したサイトのみ・60秒キャッシュ）。
  - 公開操作をした「掲載」項目だけを返す。下書き・業務データ（目標/タスク/発送）・認証情報・顧客情報は返さない。
- 保存先: Cloudflare D1 の別ドキュメント（`site-draft` / `site-public` / `site-public-previous`）。業務データ（`workspace`）とは分離。
- 編集・公開は管理者ログイン必須。公開サイトに管理用キーは不要（読み取りのみのため）。
- 許可オリジンは `SITE_ORIGINS`（既定: sickstyle-site.vercel.app / sickstyle.net / www.sickstyle.net）。

## サイト側の対応（未実施：ソースのリポジトリ確認待ち）
公開サイトのコードを変える前に差分を提示します。予定している方針:
1. ビルド/ISR時にサーバー側で `https://sickstyle-manager.sickstyle-74h4.workers.dev/api/public/site` を取得（`revalidate: 300` 程度）。ブラウザーから毎回呼ばないので無料枠への影響は小さい。
2. 取得失敗・未公開（`publishedAt: null`）・項目が空のときは、**現在サイトに書かれている内容をそのまま表示**（フォールバック）。デザインは変更しない。
3. 置き換える範囲は 商品カード（名前・価格・説明・バッジ・リンク・SOLD OUT表示）→ Philosophy → お知らせ（新設する場合はデザイン案を先に提示）の順に小さく進める。

## 注文・問い合わせの取り込み
- サイト自体には保存先がないため、取り込む対象はない。
- 自社EC（BASE）の注文は、BASEの公式API（BASE Developers、OAuth認可・無料）または注文CSVで「発送管理」へ取り込み可能。実装する場合は本人認可が必要（未実装）。
