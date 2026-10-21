# AI社員 Mac自動ランナー：セットアップ・制限事項

## 仕組み
1. 本番管理アプリでAI社員の依頼を保存（既存D1のqueued状態）。
2. 本人のMacで起動したランナーが約15秒ごとに未実行依頼を取得。
3. ログイン済みClaude Code CLIを既存のrun-task.jsで安全な読み取り分析に使用。
4. 成果物JSONを既存AI社員APIに自動取り込みし、管理アプリの人間レビュー待ち状態にする。

Cloudflare WorkerがClaudeを直接起動する構成ではありません。Macとランナーが稼働している間だけ処理できます。

## 本人が最初に行うこと
- MacのSICK-STYEL作業ディレクトリを最新ブランチに更新し、未コミットの変更は保護する。
- Node.js 24、npm、Claude Codeのインストール・本人ログインが必要。追加APIキーや従量課金プランへの変更は不要です（Claudeの既存契約上限には従います）。
- npm ci を実行後に、ターミナルで npm run ai:runner を実行。
- SICKSTYLE管理アプリの管理者メールアドレスと専用パスワードをMacのターミナルへ入力。ログインCookieはメモリのみ。パスワードはログにもファイルにも保存しない。
- ターミナルを起動した状態で、ブラウザーのAI社員画面から新しい依頼を保存してください。コピー操作は不要。
- 一回だけの処理を確認するには npm run ai:runner -- --once を使う。

## セキュリティと運用上の注意
- ランナーは既存の公開Worker URLにのみ接続。外部サイトへ管理者パスワードを送らない。
- Macがスリープ・停止している間は処理不可。セッションの24時間有効期限を過ぎたら再ログインが必要。
- Claudeの利用上限・CLIエラー時は処理停止。失敗した依頼は同じ起動中に無限に再試行しない（再起動では再処理され得る）。
- CLIはツールなしの安全な分析モード。外部投稿、DM送信、発注、価格変更、リポジトリ変更等は実行しない。
- 依頼ID・入力ハッシュ・revision・依頼状態を再検査し、更新済み依頼の結果を勝手に上書きしない。
- 自動取り込みは自動承認ではない。分析結果の根拠・数値は管理者がレビューする。
- 既存のClaude Code購読認証を利用。課金条件・上限は本人のプランによる。
- 未来の24時間稼働やMac自動起動は別設計。CloudflareからClaude Codeを直接起動することはできません。

## Amazon SP-APIの次のステップ
1. Solution Provider Portalで、開発者登録の承認後に自社用非公開SP-APIアプリクライアントを作成。
2. LWA Client ID / Client Secretを表示し、自社出品アカウントをSelf-authorizeしてRefresh Tokenを発行。
3. Macのターミナルで npm run integrations:amazon -- --plan を確認。
4. 本番Secrets変更の影響と対象Workerを確認し、本人が承認した場合のみ npm run integrations:amazon -- --apply を実行。
5. npm run integrations:amazon-refresh -- --plan を確認後、本人承認した場合のみ --apply で非表示入力。
6. SICKSTYLE Amazon連携画面で今すぐ同期を押し、Sales/Orders両APIの実データ取得を検証。
認証情報・Refresh Token・クライアントシークレットはチャットやGitHubには貼らないこと。
