# 限定委譲ランナー（独立レビュー待ち）

`run-task.js --provider claude --delegate <担当> --model <固定ID> --run --delegation-approval <私有JSON>` を追加した。承認ファイルなしの既存経路は認証前に停止する。API認証、設定変更、フック無効化、自動再試行は追加しない。今回の区切りはコードとオフライン負例のみで、実モデルの成功や本番反映を意味しない。

確認記録は人が契約・追加使用OFF・残枠・実効設定を確認して用意する。ランナーは確認済みの値を自動で作らない。私有ディレクトリ0700内の通常ファイル0600を要求し、10分以内、担当とroleの対応、モデル、packet全体・実装・定義・設定inventoryのSHA256を照合する。UUID tokenは `data/delegation-tokens/` に排他的に消費し、失敗/不明も再利用できない。コピーした記録でも同じtokenは使えない。

記録の必須項目は `version:1`, `profile:claude-2.1.296-deny-only-v2`, `token`, `mode`（`baseline`または`delegated`）, `delegate`, `model`, `packet_sha256`, `settings_sha256`, `source_sha256`, `checked_at`、および次のtrue値: `subscription_confirmed`, `extra_usage_disabled`, `no_additional_charge_confirmed`, `usage_available`, `effective_policy_reviewed`, `no_other_hooks_or_plugins`, `no_remote_or_mdm_policy`, `quality_review_required`。hash方式は `delegate-runtime.js` の `hash` と `settingsPaths/settingsSnapshot` に定義する。これは本人の事実確認であり、設定ファイルだけで契約や接続を推測するものではない。

この初期プロファイルは macOS + Claude Code 2.1.296 + firstPartyのpro/maxを限定対象とする。`/status` と `claude doctor` による実効設定確認が必要。ローカルinventoryは追加の変化検出で、MDM/サーバーポリシーを自動で完全に列挙できるとの保証はしない。既存のフック、インストール済みプラグイン、env上書き、未知の設定、MDM、別CLAUDE_CONFIG_DIRがある場合は停止する。それらを削除・無効化して通過させず、必要なら別の互換プロファイルを独立レビューする。現在のMacがこの限定条件に適合するかは未確認。

追加するセッション設定はSessionStartと全ツール対象PreToolUseの同期command hookのみで、exec形式・`onFailure:block`。開始hookの成功イベントと私有markerが揃うまでstdinに依頼を渡さない。CLIがstdinを受け取るまでSessionStartを出さない場合、15秒で停止する。この順序が実CLIで成立するかは次の限定試験の対象であり、待機解除のために先にpromptを渡す回避はしない。

PreToolUseは担当・全入力・session・親階層を検査し、一回markerと入力hash/ツールID証拠を残す。許可値やupdatedInputは返さず `{}` で既存permissionに委ねる。標準ツールはAgentのみ、子はtools[]、空MCP、depth1、最大同時2、親12/子8ターン、5分、出力4MB。未知のhook/ログ・拒否・stderr・追加使用・子ツールを検出するとプロセス群を停止する。

成果物保存には、startup/PreToolUseの成功、guardの一回marker、入力hashとtool ID一致、既存の厳格な非同期監査がすべて必要。不明・失敗は取込用JSONを出さない。成立しても `quality_approved:false` であり、内容品質の本人レビューと採用判断は別工程。

公式仕様: [hooks](https://code.claude.com/docs/en/hooks)、[設定の優先順位](https://code.claude.com/docs/en/settings)。`-p` は不正な設定を無視する場合があるため、設定ファイルの存在だけをガード稼働証拠にはしない。


## UTF-8修正・私有証拠・比較経路（再レビュー待ち）

stdout/stderrは元Bufferを上限内で保持し、fatalなTextDecoderのstreamモードでデコードする。不正列・途中切れを置換して受理しない。raw bytesのSHA256、デコード後をUTF-8化したSHA256、受信bytes数、保存bytes数、打切り有無を区別する。有効なUTF-8では両hashは一致するが、出自を区別して記録する。

本番実行時の証拠保存先は `~/Library/Application Support/SICKSTYLE/private-runs/<UUID>/`。既存の親ディレクトリがsymlinkでないことと所有者/権限を確認し、0700/0600で作る。リポジトリ、Documents、CloudStorage、Mobile Documentsの中に置かない。MacでLibrary/Application Supportが通常のローカルディレクトリかつ0700、クラウド同期用属性なしと確認した。任意の第三者バックアップ製品まで無同期と保証するものではない。

成功・失敗とも、モデル起動後はstdout/stderrの元bytesとデコード結果、packet、prompt、固定定義、設定inventoryのhash、追加セッション設定、policy、承認記録、startup/tool marker、単回token消費証拠、終了状態を私有保存する。auth status本文・環境変数・資格情報は保存しない。本文をチャット/GitHubへ送らない。上限超過時の生ログは上限までのprefixであり、完全記録として扱わない。保存に失敗した場合は一時証拠を消さず、成果物保存も行わない。

保存完了後だけ一時dirを削除し、sidecarへ証拠directoryとmanifest hashを記録する。再検証は次の読取専用コマンドで、ファイル権限・個別hash・元bytesの厳密デコード・承認の実行時有効性・guard marker・ログ監査を再実行する。出力は件数と成否のみ。hash anchorはsidecarから渡す。同一OSユーザーがsidecarと全証拠を同時に改ざんできない保証や暗号署名は提供しない。

```text
node scripts/ai-staff/replay-run.js PRIVATE_RUN_DIRECTORY MANIFEST_SHA256
```

比較用の親単独は `--provider claude --model MODEL --run --comparison-baseline --delegation-approval PRIVATE_APPROVAL`。委譲経路とは別のmodeに紐付いた承認tokenが必要。双方とも固定model、同じpacketと品質指示、effort low、親12ターン、5分、stdout4MB、stream-json＋プロンプト指定JSON（json-schemaツールなし）、同じcwd/設定確認/開始guard/証拠保存を使用する。差は委譲許可と専用指示、子実行の有無。親単独はtools空、PreToolUseも全拒否。通常の旧baselineコマンドをこの比較結果に混ぜない。子の追加消費は親単独との差として測定し、同一消費量とは主張しない。

実機開始順序と新baselineログ形式は未実証で、未知形式は停止する。今後は3代表ケースの親比較6セッション＋残り27ケースの委譲能力評価27セッションを予定する。業務評価計33親セッション・30子実行で、guard試験は別枠。30ケース全件の親比較とは表現しない。

### 統計の追加監査（独立レビュー指摘への対応）

親単独・委譲の双方で、各assistantと各resultの `usage.server_tool_use` を共通関数で照合する。存在する場合はweb search/fetchの2キーが数値0であることを要求し、非ゼロ・不正型・未知キー・欠落キーを拒否する。報告がない場合は `server_tool_usage_complete:false`、`server_tool_calls:null` とし、観測されていない実行をゼロと断定しない。既存のtool件数は `tool_counts_scope:observed_transcript` で範囲を明示する。

`subagent_stats` も共通化し、全フィールドとネストされたrequested/by_type/killed/refusedを厳密に検証する。親単独では提示された統計がすべて0（by_typeは空）であること、委譲では既存の1子完了プロファイルとの一致を要求する。親単独の統計欠損は `subagent_stats_present:false`、委譲の統計欠損は拒否する。新しい実CLI形式の受理は実証・レビュー前に広げない。

### セッション限定プラグイン案（実行経路未接続）

`session-plugin-plan.js`はオフラインで限定案を生成するだけで、CLI起動・設定読書き・承認記録の作成を行わない。frontend-design/codex/discordの3件だけを対象に、既知設定の型とmarketplace定義を厳格に確認する。未知設定、追加plugin、既存の安全hooks、managed状態不明は拒否する。原設定・インストール実体の提示hash・overrideを別々に記録するが、提示情報が実機の実効状態だと証明する機能ではない。

Codexプラグインの停止は同プラグインのSessionStart/Stop/SessionEndも止める。すべての安全hooksを維持するとは表現しない。通知設定は保持し、Remote Control状態の確認を必要とする。利用には明示された切替承認、実機inventory照合、実行経路への別実装と独立レビュー、開始/子実行の実証が必要で、この案だけでは既存のプラグイン拒否条件を通過しない。
