# 限定委譲ランナー（観測者分離差分は独立レビュー待ち）

`run-task.js --provider claude --delegate <担当> --model <固定ID> --run --delegation-approval <私有JSON>` を追加した。承認ファイルなしの既存経路は認証前に停止する。API認証、設定変更、フック無効化、自動再試行は追加しない。今回の区切りはコードとオフライン負例のみで、実モデルの成功や本番反映を意味しない。

旧deny-only profileの確認記録は人が用意する。セッション限定v4では、ユーザーの許可とassistantによるツール観測を分離する（下記）。ランナー自身が許可や確認済みの値を生成することはない。私有ディレクトリ0700内の通常ファイル0600を要求し、10分以内、担当とroleの対応、モデル、packet全体・実装・定義・設定inventoryのSHA256を照合する。UUID tokenは `data/delegation-tokens/` に排他的に消費し、失敗/不明も再利用できない。コピーした記録でも同じtokenは使えない。

記録の必須項目は `version:1`, `profile:claude-2.1.296-deny-only-v2`, `token`, `mode`（`baseline`または`delegated`）, `delegate`, `model`, `packet_sha256`, `settings_sha256`, `source_sha256`, `checked_at`、および次のtrue値: `subscription_confirmed`, `extra_usage_disabled`, `no_additional_charge_confirmed`, `usage_available`, `effective_policy_reviewed`, `no_other_hooks_or_plugins`, `no_remote_or_mdm_policy`, `quality_review_required`。hash方式は `delegate-runtime.js` の `hash` と `settingsPaths/settingsSnapshot` に定義する。これは本人の事実確認であり、設定ファイルだけで契約や接続を推測するものではない。

この初期プロファイルは macOS + Claude Code 2.1.296 + firstPartyのpro/maxを限定対象とする。旧deny-only profileは `/status` と `claude doctor` による実効設定確認が必要。v4は非対話専用で、起動前の固定CLI診断とinventory、起動後かつ入力前のinitを別々に検証する。対話 `/status` を取得したと記録しない。ローカルinventoryは追加の変化検出で、MDM/サーバーポリシーを自動で完全に列挙できるとの保証はしない。既存のフック、インストール済みプラグイン、env上書き、未知の設定、MDM、別CLAUDE_CONFIG_DIRがある場合は停止する。それらを削除・無効化して通過させず、必要なら別の互換プロファイルを独立レビューする。現在のMacがこの限定条件に適合するかは未確認。

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

新しい承認profileは`claude-2.1.296-session-three-plugins-v4`。旧profileからの自動移行はない。`session-plugin-inventory.js`が原設定・registry・インストール先の全通常ファイル（node_modulesと`.in_use`も含む）を読み取りhash化する。追加設定、未知設定、別scope、管理設定が存在する場合は停止する。依存symlinkは同じ実体root内の通常ファイルへ直接解決される場合のみ、リンク文字列・相対解決先・内容hashを記録する。外部参照・循環・dangling・連鎖・ディレクトリリンクは拒否する。実機の`.in_use`はdirectoryなので除外せず、root/別位置とも通常fileとdirectory配下をすべてhash対象にする。同名symlinkは拒否する。このprofileには可変marker除外はない。探索は50,000項目/256MBに制限し、上限超過も停止する。plan生成器・inventory・bindingを含む実装hashと、packet/model/mode/CLI版/原設定/実体/overlay/policy証拠を結び付ける。

承認には従来の料金・利用枠・本人認証・10分期限・UUID単回tokenに加え、`binding_sha256`、`identity_sha256`、`usage_observation_sha256`、正確な`plugin_ids`、`session_only_three_plugins:true`、`codex_plugin_hooks_absent_acknowledged:true`、`persistent_settings_changes_allowed:false`、`managed_override_allowed:false`、`other_plugins_disabled_allowed:false`、`independent_review_confirmed:true`、`remote_control:"headless_not_requested"`、`remote_policy:"not_applicable_to_current_credential"`、`no_mdm_policy:true`、`policy_applicability_reviewed:true`が必要。`approval_evidence_ref`は実際の限定承認を記録した絶対パス、`approval_evidence_sha256`はそのファイル本文のSHA256。`no_other_hooks_or_plugins:true`は、この明示された3件と固定CLI組込3件以外に実行対象がないという確認を意味する。これらの真偽値を自動作成する機能はない。

`policy_observation_path`は私有ファイル（親0700・本人所有・ファイル0600）の絶対パス。内容は`version:3`、`managed_policy:"confirmed_absent"`（endpoint-managedのみ）、`remote_policy:"not_applicable_to_current_credential"`、`remote_control:"headless_not_requested"`、`remote_applicability`、`observation`（下記のツール観測者情報）、10分以内の`checked_at`、実確認を記録した私有`evidence_ref`と本文`evidence_sha256`。旧remote不在/RC切断済みの値や承認profileは自動変換せず拒否する。MDM/ローカル管理policy確認は維持する。証拠本文hashを照合し、私有run証拠にも保存する。同一OS利用者の自己申告を暗号学的に認証する仕組みではない。

`policy-applicability.js`は保存claude.ai/firstParty/Pro認証、固定2.1.296実体のhash、standalone doctorの終了0と実測した正確なTeam/Enterprise対象外行、remote-settings.json不在、標準Anthropic profileディレクトリ不在、credential上書きなしを記録する。取得失敗・cacheあり・別credential・別CLI・別config/home・hosting指標は停止する。`~/.claude/remote-settings.json`と`~/.config/anthropic`もinventoryへ追加し、変更検出する。診断は`--version`、`auth status --json`、standalone `doctor`、再度`auth status --json`だけで、モデルを呼ばない。認証本文やcredential値は証拠へ保存しない。モデル実行直前に同じcwd/envで再診断し、承認に結合した値との一致と期限を確認する。固定絶対実体を直接実行し、PATH上のwrapperは使用しない。

Remote Controlの判定はfresh UUIDをランナー自身で生成した非対話`-p`起動に限定する。全引数配列をcanonical `runtimeArgs`と一致させ、追加・欠落・RC/resume/continue/attach/cloud/hosting引数を拒否する。自動接続がinteractiveのみという[公式仕様](https://code.claude.com/docs/en/remote-control#enable-remote-control-for-all-sessions)に基づく`headless_not_requested`であり、「既存/未来sessionの切断確認」や「通信なし証明」ではない。保存した実診断と起動引数hashもreplayで照合する。server-managed対象と診断の意味は[適用条件](https://code.claude.com/docs/en/server-managed-settings#platform-availability)と[standalone doctor](https://code.claude.com/docs/en/server-managed-settings#verify-settings-delivery)に基づく。

本人・組織は`auth status --json`が返す`email`と`orgId`を使う。emailはtrim/NFC/小文字化だけを行い、plusやdotによる別名統合はしない。orgIdはtrim/小文字化したUUID形式のみ受理する。欠損・不正型・不正形式を拒否し、domain-separated SHA256でaccount/org/組合せidentityを記録する。生email・orgId・OAuth token・表示名は診断証拠へ保存しない。hashは照合用であり、完全匿名化を意味しない。`remote_applicability`はversion 2とし、doctor前後のidentity差分も停止条件にする。

`usage_observation_path`は同じ私有ファイル制約を満たす、10分以内の本人確認記録。`version:2`、`source:"claude.ai_account_and_usage_ui"`、`observation`（下記のツール観測者情報）、`checked_at`、`browser_account_sha256`、`cli_identity_sha256`、`subscription_type:"pro"`、`extra_usage_enabled:false`、`usage_available:true`、`evidence_ref`と本文`evidence_sha256`が必要。ブラウザのアカウント画面または本人メニューで読めるemailのhashをCLIのaccount hashと一致させ、その確認と同時に照合したCLIのaccount/org組合せhashを記録する。ブラウザでorgIdを観測したとは主張しない。本人の画面と利用枠の対応が取得不能なら記録を作らず停止する。追加の承認を自動生成する機能ではない。

利用枠記録の本文hashとidentity hashは承認bindingに含める。実行直前のCLI identity、承認済みpolicy identity、ブラウザ本人hash、利用枠記録に結合したCLI identityのすべてが一致し、元の10分期限内でなければ実行しない。別account・別org・承認後の切替を拒否する。利用枠記録と証拠を私有保存し、replayでも同じ照合を行う。旧v2/v3承認は自動変換しない。

CLIに渡す追加設定は対象3件の`enabledPlugins:false`と既存guardのみ。通常設定は変更しない。入力送信にはstartup markerと成功hookだけでなく、initのCLI版・ツール・model・dontAsk・API keyなし・空MCP・固定組込plugin集合の一致も必要。CLIがstdin前にinitを出さない場合は時間切れで停止する。組込は`cc-plugin-agents-md`、`cc-plugin-telemetry`、`cc-plugin-plugin-authoring`の3件で、すべてpath=`builtin`・source=`名前@builtin`を要求する。

initのMCP空とplugin集合の一致は、init前の通信やDiscordプロセス不在の証明ではない。実体hashは変更検出のためで、無効化するpluginの依存を実行して安全性を検査するものではない。プロセス不在、実際の開始順序、子の制約継承は実機検証まで未確認であり、品質承認は常にfalseのまま。この統合差分の独立レビュー前には実CLI/modelを起動しない。保存証拠のreplayでも限定承認・policy証拠・binding・initを再検証する。


### v4: ユーザーの許可とツール観測の出所

権限主体はユーザーのまま。`approval_evidence_ref` の本文はJSONの `user_authorization` 記録であり、`version:1`、`authority:"user"`、対象 `identity_sha256`、非空の `source_references` が必要。各参照は `author:"user"`、元の `thread_id`、`message_ref`、実際のユーザー原文 `quote` を持つ。伝達したassistantの指示をユーザー原文へ置き換えない。`scope` は `authorizationScope()` の全項目と一致させ、repository・mode・delegate・model・packet hash・3プラグイン・セッション限定・Codex hooks停止了承に結合する。恒久設定変更、managed override、追加課金、本番変更、成果の品質承認はいずれもfalse。参照欠損、別範囲、assistantを権限主体とした記録は拒否する。

policy/usageの `observation` は `{kind:"verified_tool_observation",observer:"assistant",methods:[...]}`。policyのmethodsは `pinned_cli_diagnostics / endpoint_enrollment / settings_inventory`、usageは `official_account_ui / official_usage_ui` の固定順。`reviewed_by` は併記も拒否し、本人が画面を見たと偽装しない。

証拠本文もJSONとして検証する。双方に `version:1, observer:"assistant", kind, checked_at, identity_sha256` が必要で、記録の日時・identityと一致させる。policy本文は `cli` に固定CLI診断全体、`endpoint` に `dep_enrolled:false, mdm_enrolled:false, inventory_sha256` を持つ。usage本文は `account:{url,account_sha256}`、`usage:{url,subscription_type:"pro",extra_usage_enabled:false,session_used_percent,weekly_used_percent}` を持つ。使用率は有限数値かつ0以上100未満。URLはclaude.aiの設定画面（`new#settings/...`へのリダイレクトを含む）、本人メニューは `/new` のみ。生email・orgId・tokenは保存しない。

証拠本文hashを照合したうえで内容を検証する。authorization本文hashも新たにbindingへ含め、policy/usage本文hash、identity、単回token、mode、実装等の既存結合を維持。起動前とreplayの双方で証拠の意味を検証する。10分期限は延長しない。`verified_tool_observation` はこの照合方式の名前であり、サービス署名や第三者による独立検証の意味ではない。同じOSユーザーが原文参照と全証拠を捏造することを暗号学的に防ぐ仕組みではなく、記録作成者は信頼できる会話と実ツール出力から正直に転記する必要がある。出所を確認できなければ作成しない。成果の採用・品質承認は別工程のまま。

### 実CLI前提のオフライン点検（2026-10-21 JST）

固定2.1.296の `--help` をモデルなしで取得。公式 [CLI reference](https://code.claude.com/docs/en/cli-reference) と [hooks](https://code.claude.com/docs/en/hooks) を再確認した。以下の未確認項目を成功へ変換しない。

| 前提 | 証拠と残る阻害 |
|---|---|
| 本人・Pro・残枠・Extra OFF | 直近の公式UIとCLIで本人hash一致、0%/4%、OFF。アカウント設定本文にはemailがなく、本人メニューで取得できた。v4はこの実際の観測場所を記録できる。実行時には新たな10分以内の証拠が必要 |
| policy/設定 | standalone doctorは現Pro認証のremote対象外、cache/profile不在、MDM/DEPなし、既知3プラグインと設定実体hash一致。実行時に再診断・再hash。通常設定の変更は不要 |
| 許可記録 | v4は既存のユーザー原文参照とassistant観測を分離できる。単回modeの記録は実行時に作成し、この修正では作らない。独立レビューが必要 |
| 起動と入力順序 | 現引数は `-p`、text stdin（既定）、stream-json stdout。公式仕様はstdin前のSessionStart/init出力順序を保証していない。mockは自発的にstartup/initを出すため、text入力をEOFまで読む実CLIとの相互待機を隠し得る。実機で15秒以内に両方が来なければ停止。先にpromptを送る、stream-jsonへ無断変更する回避は不可 |
| hooks | exec形式command+argsは公式対応。onFailure:blockは2.1.295以降対応。mockのEventEmitterではCLIによる設定merge、実hook起動失敗、timeoutの伝播を実証できない。SessionStart失敗時はランナー自身も入力を解放しない |
| initの厳格形式 | builtin3件、apiKeySource、model、session、MCP空、tools集合は固定条件。CLIが実際に返す形式と一致するかは未実証。mock内のJSONを実機証拠としない |
| Agent入力 | 厳密なminified packet JSON、固定項目、親1回・子tools空を要求。実際のモデルが余分な項目や整形済JSONを送れば拒否する。mockは正解の入力を注入するため、生成の成功率や子への制約継承は未確認 |
| 私有証拠/再監査 | 合成ログの保存・再監査は試験済み。実CLIの失敗ログを含む保存と実ログ監査は未実証。成果品質は常に別判定 |

したがって「全前提を実機で充足済み」とはまだ報告できない。入力順序とCLIの実ログ形式が残る主要な実証項目。ガード検証最大3起動、成功後のdq-01比較1組という区切りは維持し、新モデルは本差分の独立レビュー後に限る。
