# 管理者の作成（初期設定）

## 「初期設定キー」とは

このアプリの**最初の管理者登録だけ**に使う、アプリ専用の秘密の文字列です（環境変数名 `SETUP_TOKEN`）。Instagram・Amazon・メール・PCのパスワードとは**無関係**です。パスワードマネージャーが別サービスのパスワードを自動入力すると一致しません。

キーを使わずに管理者を作る方法（推奨）を用意しています。

## ローカル（このMacだけで使う場合）

「ターミナル」アプリで次を実行します。

```sh
cd ~/Sites/SICK-STYEL
npm run admin:create
```

表示に従ってメールアドレスと、このアプリ専用のパスワード（12文字以上）を2回入力します。パスワードは画面に表示されません。「管理者を作成しました」と出たら `npm start` で起動し（起動済みなら再読み込み）、http://127.0.0.1:3000 でログインします。既に管理者がいる場合は何も変更しません。

## 公開版（スマホ・別PCから使う場合）

公開版ではWeb上の初回登録を**閉じたまま**運用します（本番に `SETUP_TOKEN` を登録しません）。Cloudflareにログイン済みのMacのターミナルで:

```sh
cd ~/Sites/SICK-STYEL
npm run admin:create:remote
```

パスワードはMac上でハッシュ化（PBKDF2-SHA256・10万回）し、ハッシュだけをCloudflare D1へ書き込みます。平文はどこにも送信・保存・表示しません。既存の管理者がいれば上書きしません。`npm run cloud:setup` の途中でも自動で実行されます。

### どうしてもブラウザーから初回登録したい場合（任意）

`npx wrangler secret put SETUP_TOKEN` で本人が決めた長いランダム文字列を登録し、その値を登録画面の「初期設定キー」に入力します。管理者作成後は登録APIが409で閉じ、画面にも表示されません。不要になったら `npx wrangler secret delete SETUP_TOKEN` で削除してください。

## 読み込みの優先順位（ローカルのNodeサーバー）

1. シェルの環境変数 → 2. `.env.local` → 3. `.env` → 4. `.env.bootstrap`（`npm run setup:local` が生成、Git対象外・権限600）。値はログに出しません。

## パスワードを忘れた場合

パスワードリセットメールはありません。ローカルは `data/sickstyle.sqlite` をバックアップした上で管理者行を削除して再作成、公開版は `npx wrangler d1 execute sickstyle-db --remote --command "DELETE FROM ss_users; DELETE FROM ss_sessions;"` の後に `npm run admin:create:remote` で再作成します（業務データは残ります）。
