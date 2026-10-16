# 公式API連携

Instagramの実装は `instagram.js`、ルートは `api/index.js` です。[Meta設定手順](../docs/instagram-setup.md)に従ってアプリ設定と本人認可を行ってください。設定・認可前は取得済みとして表示しません。

`index.js`のmanualAdapterは未設定サービス向けの明示的な拡張ポイントです。Amazon公式APIの認可・同期は未実装で、売上を手入力できます。将来のAmazonアダプターでは日付・通貨・重複更新を固定し、秘密情報をサーバー環境変数で管理してください。
