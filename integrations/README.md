# 公式API連携

Instagramは`instagram.js`、Amazon SP-API/LWAは`amazon.js`、認証済みAPIルートは`api/index.js`です。既存の認可・暗号化・読み取り同期を使い、コードの存在だけで接続済みとしません。安全な本人認証の引き継ぎは[Issue #2の手順](../docs/integrations/issue-2-handoff.md)を参照してください。

`safeStatus.connected`は保存済み認可・設定の有無であり、実データ取得の証明ではありません。`readiness`と`cache.syncVerified`で認証待ち・同期未検証・読み取り同期成功を区別します。AmazonはSales/Ordersごとに成功日時・期間・エラーを保存します。ダッシュボードはAPI値と手入力/CSVを合算しません。

`index.js`のmanualAdapterは未設定サービス向けの拡張点です。BASE・TikTok・Metricoolのアプリ内アダプターやCanvaデザイン用MCPは未接続です。料金不明のAPIや有料機能を自動実行しません。
