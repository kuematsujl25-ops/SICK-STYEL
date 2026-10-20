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

### セッション限定プラグイン経路（実機未検証・独立レビュー待ち）

`session-plugin-plan.js`はオフラインで限定案を生成するだけで、CLI起動・設定読書き・承認記録の作成を行わない。frontend-design/codex/discordの3件だけを対象に、既知設定の型とmarketplace定義を厳格に確認する。未知設定、追加plugin、既存の安全hooks、managed状態不明は拒否する。原設定・インストール実体の提示hash・overrideを別々に記録するが、提示情報が実機の実効状態だと証明する機能ではない。

Codexプラグインの停止は同プラグインのSessionStart/Stop/SessionEndも止める。すべての安全hooksを維持するとは表現しない。通知設定は保持する。Remote Controlは下記の新規直接非対話起動への適用条件で確認する。利用には明示された切替承認、実機inventory照合、統合差分の独立レビュー、開始/子実行の実証が必要。

新しい承認profileは`claude-2.1.296-session-three-plugins-v2`。旧profileからの自動移行はない。`session-plugin-inventory.js`が原設定・registry・インストール先の全通常ファイル（node_modulesと`.in_use`も含む）を読み取りhash化する。追加設定、未知設定、別scope、管理設定が存在する場合は停止する。依存symlinkは同じ実体root内の通常ファイルへ直接解決される場合のみ、リンク文字列・相対解決先・内容hashを記録する。外部参照・循環・dangling・連鎖・ディレクトリリンクは拒否する。実機の`.in_use`はdirectoryなので除外せず、root/別位置とも通常fileとdirectory配下をすべてhash対象にする。同名symlinkは拒否する。このprofileには可変marker除外はない。探索は50,000項目/256MBに制限し、上限超過も停止する。plan生成器・inventory・bindingを含む実装hashと、packet/model/mode/CLI版/原設定/実体/overlay/policy証拠を結び付ける。

承認には従来の料金・利用枠・本人認証・10分期限・UUID単回tokenに加え、`binding_sha256`、正確な`plugin_ids`、`session_only_three_plugins:true`、`codex_plugin_hooks_absent_acknowledged:true`、`persistent_settings_changes_allowed:false`、`managed_override_allowed:false`、`other_plugins_disabled_allowed:false`、`independent_review_confirmed:true`、`remote_control:"headless_not_requested"`、`remote_policy:"not_applicable_to_current_credential"`、`no_mdm_policy:true`、`policy_applicability_reviewed:true`が必要。`approval_evidence_ref`は実際の限定承認を記録した絶対パス、`approval_evidence_sha256`はそのファイル本文のSHA256。`no_other_hooks_or_plugins:true`は、この明示された3件と固定CLI組込3件以外に実行対象がないという確認を意味する。これらの真偽値を自動作成する機能はない。

`policy_observation_path`は私有ファイル（親0700・本人所有・ファイル0600）の絶対パス。内容は`version:2`、`managed_policy:"confirmed_absent"`（endpoint-managedのみ）、`remote_policy:"not_applicable_to_current_credential"`、`remote_control:"headless_not_requested"`、`remote_applicability`、`reviewed_by:"human"`、10分以内の`checked_at`、実確認を記録した私有`evidence_ref`と本文`evidence_sha256`。旧remote不在/RC切断済みの値や承認profileは自動変換せず拒否する。MDM/ローカル管理policy確認は維持する。証拠本文hashを照合し、私有run証拠にも保存する。同一OS利用者の自己申告を暗号学的に認証する仕組みではない。

`policy-applicability.js`は保存claude.ai/firstParty/Pro認証、固定2.1.296実体のhash、standalone doctorの終了0と実測した正確なTeam/Enterprise対象外行、remote-settings.json不在、標準Anthropic profileディレクトリ不在、credential上書きなしを記録する。取得失敗・cacheあり・別credential・別CLI・別config/home・hosting指標は停止する。`~/.claude/remote-settings.json`と`~/.config/anthropic`もinventoryへ追加し、変更検出する。診断は`--version`、`auth status --json`、standalone `doctor`、再度`auth status --json`だけで、モデルを呼ばない。認証本文やcredential値は証拠へ保存しない。モデル実行直前に同じcwd/envで再診断し、承認に結合した値との一致と期限を確認する。固定絶対実体を直接実行し、PATH上のwrapperは使用しない。

Remote Controlの判定はfresh UUIDをランナー自身で生成した非対話`-p`起動に限定する。全引数配列をcanonical `runtimeArgs`と一致させ、追加・欠落・RC/resume/continue/attach/cloud/hosting引数を拒否する。自動接続がinteractiveのみという[公式仕様](https://code.claude.com/docs/en/remote-control#enable-remote-control-for-all-sessions)に基づく`headless_not_requested`であり、「既存/未来sessionの切断確認」や「通信なし証明」ではない。保存した実診断と起動引数hashもreplayで照合する。server-managed対象と診断の意味は[適用条件](https://code.claude.com/docs/en/server-managed-settings#platform-availability)と[standalone doctor](https://code.claude.com/docs/en/server-managed-settings#verify-settings-delivery)に基づく。

CLIに渡す追加設定は対象3件の`enabledPlugins:false`と既存guardのみ。通常設定は変更しない。入力送信にはstartup markerと成功hookだけでなく、initのCLI版・ツール・model・dontAsk・API keyなし・空MCP・固定組込plugin集合の一致も必要。CLIがstdin前にinitを出さない場合は時間切れで停止する。組込は`cc-plugin-agents-md`、`cc-plugin-telemetry`、`cc-plugin-plugin-authoring`の3件で、すべてpath=`builtin`・source=`名前@builtin`を要求する。

initのMCP空とplugin集合の一致は、init前の通信やDiscordプロセス不在の証明ではない。実体hashは変更検出のためで、無効化するpluginの依存を実行して安全性を検査するものではない。プロセス不在、実際の開始順序、子の制約継承は実機検証まで未確認であり、品質承認は常にfalseのまま。この統合差分の独立レビュー前には実CLI/modelを起動しない。保存証拠のreplayでも限定承認・policy証拠・binding・initを再検証する。
