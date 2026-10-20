# 限定委譲ランナー（独立レビュー待ち）

`run-task.js --provider claude --delegate <担当> --model <固定ID> --run --delegation-approval <私有JSON>` を追加した。承認ファイルなしの既存経路は認証前に停止する。API認証、設定変更、フック無効化、自動再試行は追加しない。今回の区切りはコードとオフライン負例のみで、実モデルの成功や本番反映を意味しない。

確認記録は人が契約・追加使用OFF・残枠・実効設定を確認して用意する。ランナーは確認済みの値を自動で作らない。私有ディレクトリ0700内の通常ファイル0600を要求し、10分以内、担当とroleの対応、モデル、packet全体・実装・定義・設定inventoryのSHA256を照合する。UUID tokenは `data/delegation-tokens/` に排他的に消費し、失敗/不明も再利用できない。コピーした記録でも同じtokenは使えない。

記録の必須項目は `version:1`, `profile:claude-2.1.296-deny-only-v1`, `token`, `delegate`, `model`, `packet_sha256`, `settings_sha256`, `source_sha256`, `checked_at`、および次のtrue値: `subscription_confirmed`, `extra_usage_disabled`, `no_additional_charge_confirmed`, `usage_available`, `effective_policy_reviewed`, `no_other_hooks_or_plugins`, `no_remote_or_mdm_policy`, `quality_review_required`。hash方式は `delegate-runtime.js` の `hash` と `settingsPaths/settingsSnapshot` に定義する。これは本人の事実確認であり、設定ファイルだけで契約や接続を推測するものではない。

この初期プロファイルは macOS + Claude Code 2.1.296 + firstPartyのpro/maxを限定対象とする。`/status` と `claude doctor` による実効設定確認が必要。ローカルinventoryは追加の変化検出で、MDM/サーバーポリシーを自動で完全に列挙できるとの保証はしない。既存のフック、インストール済みプラグイン、env上書き、未知の設定、MDM、別CLAUDE_CONFIG_DIRがある場合は停止する。それらを削除・無効化して通過させず、必要なら別の互換プロファイルを独立レビューする。現在のMacがこの限定条件に適合するかは未確認。

追加するセッション設定はSessionStartと全ツール対象PreToolUseの同期command hookのみで、exec形式・`onFailure:block`。開始hookの成功イベントと私有markerが揃うまでstdinに依頼を渡さない。CLIがstdinを受け取るまでSessionStartを出さない場合、15秒で停止する。この順序が実CLIで成立するかは次の限定試験の対象であり、待機解除のために先にpromptを渡す回避はしない。

PreToolUseは担当・全入力・session・親階層を検査し、一回markerと入力hash/ツールID証拠を残す。許可値やupdatedInputは返さず `{}` で既存permissionに委ねる。標準ツールはAgentのみ、子はtools[]、空MCP、depth1、最大同時2、親12/子8ターン、5分、出力4MB。未知のhook/ログ・拒否・stderr・追加使用・子ツールを検出するとプロセス群を停止する。

成果物保存には、startup/PreToolUseの成功、guardの一回marker、入力hashとtool ID一致、既存の厳格な非同期監査がすべて必要。不明・失敗は取込用JSONを出さない。成立しても `quality_approved:false` であり、内容品質の本人レビューと採用判断は別工程。

公式仕様: [hooks](https://code.claude.com/docs/en/hooks)、[設定の優先順位](https://code.claude.com/docs/en/settings)。`-p` は不正な設定を無視する場合があるため、設定ファイルの存在だけをガード稼働証拠にはしない。
