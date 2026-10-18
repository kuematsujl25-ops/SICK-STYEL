# SICK STYLE AI社員の手動運用

## 今回の変更

管理画面の「AI社員」で9担当を選び、依頼と根拠を保存できる。依頼書をダウンロードし、Macの既存契約でClaude CodeまたはCodex CLIを実行する。成果物JSONを取り込み、本人が採用または差し戻す。D1の既存`ss_documents`へ専用文書として保存し、業務KPIと混ぜない。DBマイグレーションや新しいSecretは不要。

担当は事業統括、市場・顧客分析、マーケティング、SNS分析、クリエイティブ、EC最適化、利益・在庫、卸売・チーム営業、グロース検証。担当定義は既存AI COOのSICK STYLE専用カタログから生成して同梱している。買取マクサス側のコード・設定は変更していない。

初期状態は停止中。開始しても常駐ジョブや従量APIは起動しない。外部投稿、DM、広告、価格変更、発注は実装していない。実行には既存契約の利用枠を使い、追加APIキー認証は拒否する。契約上限に達したら停止し、有料の追加枠やAPIへ切り替えない。

## Macで準備

このブランチの作業ディレクトリで実行する。Node.js 24が必要。変更のある既存ディレクトリを強制リセットしない。

```bash
git fetch origin ai-staff/phase4-runtime
git switch ai-staff/phase4-runtime
npm ci
npm test
```

Claude Code/Codex CLIはインストール済み・本人ログイン済みという申告に基づく。CLIの対応オプションを実行時に確認し、不足する版は停止する。CLIは独立した認証を使うため、このリポジトリにAPIキーを登録しない。

## AI社員に依頼する

1. 本番反映後、本人ログインして「AI社員」→「手動運用を開始」。
2. 担当、依頼名、目的を入力。根拠は任意。取得元と日付を添え、秘密値・個人情報は入力しない。根拠なしの依頼は情報不足として分析される。
任意の「根拠CSV」には`docs/integrations/templates/`のBASE/TikTok/Metricoolひな形を利用できる。確認した日付・取得日時・取得元を埋め、未取得の値は空欄のままにする。Metricoolはチャネルも指定する。1〜30行を担当への根拠として取り込み、既存のAmazon売上やSNS KPIへ加算しない。数式・重複・未来日時・単位の不一致・個人情報を拒否する。

3. 「CLI実行用の依頼をダウンロード」で依頼JSONをMacへ保存。
4. 作業ディレクトリで、ダウンロードしたファイルの実際のパスを指定して実行する。`--run`なしは入力確認だけでモデルを呼ばない。

```bash
npm run ai:task -- "$HOME/Downloads/sickstyle-task-依頼ID.json" --provider claude --run
# Codexを使う場合:
npm run ai:task -- "$HOME/Downloads/sickstyle-task-依頼ID.json" --provider codex --run
```

5. 表示された`data/ai-results/…json`を管理画面へ取り込む。
6. 入力した根拠、成果物、制約を照合し、レビュー理由を入力して採用・差し戻し。採用しても外部操作は実行されない。

実行結果は本人が登録する文書であり、CLIが生成したことをサーバーが暗号学的に証明する仕組みではない。構造検証は記述の真偽・因果・計算の正しさを保証しない。別依頼の結果、入力改変、未取得・仮説の根拠参照、不明な予測利益、重複実行IDは拒否する。依頼IDはサーバーが生成する小文字のUUID v4形式に限定し、CLI認証・モデル実行前に検証する。成果物保存時も依頼ID・実行IDを検証し、解決したパスが`data/ai-results`直下に収まることを確認する。

結果取込は1依頼2回まで。依頼は日本時間1日20件・全体200件、結果は120KB、文書は通常700KBまで。上限に近づいたら停止・バックアップして運用を見直す。保存上限に達しても停止できる領域を予約している。無制限の長期運用・自動アーカイブは今回の対象外。レビュー時点の成果物・実行情報・理由を保存し、効果は常に「未測定」から始める。

「依頼・成果物・レビュー履歴をバックアップ」はAI社員専用の認証必須JSON。既存の業務データバックアップとは別。今回バックアップの復元UIは未実装。`data/`はGit対象外。ファイルやバックアップをGitHubへアップロードしない。

## Claude Code開発 → Codexレビュー

Claude Codeへ開発を依頼する場合の入力例（このセッションではCodexが実装した）:

> AGENTS.mdとCLAUDE.mdを読み、SICK STYLEのみを変更してください。作業ブランチで実装・npm test・コミットまで行い、独立Codexレビューへ渡してください。API課金、Secret変更、他事業変更、投稿・送信・マージは行わないでください。

変更をコミットし、以下で別のCodex CLIプロセスからレビューする。比較元は既存機能全体を含めて点検するためデフォルトブランチ。ローカルの未コミット変更があると停止する。

```bash
npm run ai:review -- --base origin/claude/initial-github-sync
```

レビューは読み取り専用・ChatGPT契約認証。結果は`data/code-reviews/`へ対象HEAD・比較元SHA付きで保存する。終了コード0はレビュー実行完了であって合格判定ではない。本人が指摘を確認し、修正後は再度コミット・テスト・レビューする。コミットが変わったら旧レビューを流用しない。

GitHub ActionsのCodexレビューはAPI課金型の別経路。`ENABLE_CODEX_REVIEW=true`に加え`CODEX_API_BILLING_APPROVED=true`が必要。この作業ではVariables/Secretsを変更せず、APIレビューを有効化していない。スキップはレビュー合格ではない。PR更新時にも起動対象とし、読み取り専用化、PRタイトル・本文のプロンプト埋め込みを削除した。ブランチ保護の設定や自動マージは変更していない。

## 既存本番へコードを反映

最新の利用者指示で本番反映は許可された。既存の`npm run deploy`はSecret作成・一括登録・DBマイグレーションを含むため、今回のコード更新には次を使う。

```bash
npx wrangler login
npm run deploy:existing                 # 変更しない計画確認
npm run deploy:existing -- --dry-run    # コード専用Versionのビルド確認（未アップロード）
npm run deploy:existing -- --apply      # 認証・Free確認・テスト後に反映
```

これは既存Worker/D1だけを対象に、Variablesを除外した一時設定と`--keep-vars`でVersionをアップロードし、その一意なタグを100%へ反映する。Secrets・Variablesの値、スケジュール、ルート、プラン、DBスキーマを変更しない。旧VersionはCloudflare Deploymentsで確認し、問題時は本人が直前VersionへRollbackする。新規リソース作成・有料アップグレードは行わない。Free確認は既存スクリプトの24時間キャッシュまたはAPI/本人確認を利用し、無料枠の残量や将来の枯渇まで保証するものではない。

反映後は公開ファイルと未認証APIの読み取りだけを検証する。本人ログイン後の機能は「AI社員」が初期停止であること、作成・取込・レビュー・停止を本人が確認する。検証スクリプトは本番の業務レコードを追加・削除しない。

## MacでWranglerが起動しない場合

`Cannot find module ... esbuild/lib/main.js`はCLIの依存ファイルが見つからない状態。作業ディレクトリで以下を順に実行する。`npm ci`は`node_modules`を作り直し、`data/code-reviews/`の結果は保持する。ターミナルにはコード枠のコマンドだけを貼り付ける。

```bash
npm ci --include=dev --include=optional --cache "$(mktemp -d)" &&
node -e "require('esbuild').transformSync('const n = 1'); console.log('esbuild OK')" &&
npx --no-install wrangler --version
```

成功後に本人ログインする。デプロイの認証判定は`whoami --json`の出力全体をJSONとして解析する。CLI起動失敗・不正な応答・未ログインを区別し、アカウント情報をエラーログへ含めない。

## Canvaと他サービス

このチャットとクラウドCLIにはCanvaのデザイン検索・編集MCPツールが公開されていない。利用者側のプラグイン接続は否定しないが、この環境からBrand Kit・デザイン・無料素材の実検索は検証できていない。追加費用を伴う生成を実行しない。

MacのClaude Codeで既存Canva MCPが使える場合は、`/mcp`で接続を本人確認し、`docs/integrations/canva-handoff.md`とSVGを渡して「既存デザイン・ブランド素材の読み取り検索と、無料素材での改善案。AIクレジットや有料素材が必要なら停止」と依頼できる。これはMacでの本人操作手順であり、このクラウドでの実行済みという意味ではない。

BASE/TikTok/Metricoolの公式接続の条件・無料収集用CSVは`docs/integrations/issue-2-handoff.md`を参照。Instagram・Amazonの実接続は今回の追加実装対象から除外。既存の設定待ち表示と前回の未検証状態を維持している。サービスの値をAI社員の根拠として渡すときも、実際に取得した値と取得元・日時だけを使う。

## 検証の限界

クラウドでNode/SQLite/Workers+D1の機能テストとブラウザー操作を実施する。CLI接続部のテストには代替プロセスも使い、実モデル実行と区別する。この環境のCodex CLIは認証状態を確認できるが、ランタイム初期化時に読み取り専用ファイルシステムのエラーで停止する。Claude CLIはこのクラウドに未導入。実モデルによるAI社員分析は未検証。利用者Macでは旧HEAD `dd270bec`の独立Codexレビューが実行され、Wrangler認証JSONを行ごとに解析しているP1が報告された。出力全体のJSON解析に修正し、複数行・未ログイン・CLI依存欠落・プロセス失敗の回帰テストを追加した。利用者MacでP1修正版 `de7ccaf`を再レビューし、依頼IDのパストラバーサルP2が報告された。UUID形式検証と成果物の保存先確認を追加し、パスを含むID・不正なUUID・CLI実行前の拒否を回帰テストで確認した。P2修正後SHAはMacで再レビューする。

Cloudflareは未ログインでデプロイが認証前に停止するため、本番反映済みとは報告しない。Macからの本人認証が必要。秘密値をチャットへ送る必要はない。
