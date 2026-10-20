# 非同期委譲記録の監査仕様 v1（オフライン）

対象は保存証拠で観測した Claude Code 2.1.296 の「親が1担当を1回起動し、完了通知で親が継続する」形式です。通常委譲を有効化する仕様ではありません。別バージョンや未知のイベント順序は推測で受理せず、独立レビュー対象に戻します。

## 信頼境界

- 呼出元は実行前に固定した `session_id`、モデル、担当、原本packetを渡します。ログから期待sessionを自動採用しません。
- ログは事後の照合証拠です。監査関数だけで実行前の制限やログの改ざん耐性を保証しません。`guard_execution_proven:false` と `quality_approved:false` を返します。
- SessionStartの成功をPreToolUseガード適用とみなしません。将来の実行経路はdeny-onlyガードの一回枠、正常終了、入力照合を別に確認する必要があります。
- 親子ツール・MCP・子への再委譲・resume/fork/model overrideの許可を増やしません。同期形式の既存検証器と、この非同期形式を混ぜて最後の結果だけを採用することはしません。

## 必須の関連付けと順序

1. 全行のsessionが期待値と一致し、全イベントUUIDが一意であること。未知のmessage/system/contentは拒否します。
2. 最初のinitは固定モデル・版・dontAsk・APIキーなし・空MCP・正確なAgent/Taskの一名称だけ・指定担当登録を満たすこと。
3. 親のtool_useは1回だけ。tool IDとwire_tool_inputsが一致し、入力キーはdescription/subagent_type/promptだけ。promptは元packetの全値・型・配列順と一致し、余計なテキストや重複キーを持たないJSONです。
4. 背景一覧1件→task_started→起動応答の順に、tool/task/run ID・担当・説明・モデル・promptを照合。深さ1、local_agent、is_backgrounded=trueのみ。起動応答では通常設定によるacceptを必要とし、bypass等は拒否します。
5. 子assistantは対応するparent_tool_use_id・agent_id・担当・モデルを持ち、呼出しやtool_resultを一つも含まないこと。子メッセージ/ターン上限を適用します。
6. task_updated(completed)→task_notification(completed)→空の背景一覧を必須とします。各task/run ID、通知tool ID、子の本文と通知summary、tool_uses=0を照合します。欠落・失敗・別担当・深さ2・重複は拒否します。
7. 2回目のinitは完了通知後だけ。最初のinitとUUID以外の全項目が一致すること。親の2つのターンの本文を別々に記録します。
8. 末尾のresultは正確に2件、result_indexが0/1。両方が成功・権限拒否なし・安全停止なし・APIエラーなし・キューなしで、呼出し数1/完了1/失敗0/再委譲0/深さ1の統計を満たすこと。親の総ターン上限も適用します。
9. index=0はoriginなし・最初の親本文と完全一致し、競合するJSON成果でないこと。index=1はorigin.kind=task-notification、producer=session-task、runIdが該当子runに一致し、継続親本文と完全一致すること。この対応付けを満たした本文だけを既存成果スキーマで検証します。任意の「最後のresult」は採用しません。
10. rate_limit_eventはallowed・追加使用なし・overage rejectedが必要です。観測されない利用形態や拒否は停止対象です。ログの推定API価格を本人への請求額と解釈しません。

PreToolUse hook記録が出る場合は開始/応答を対応付け、exit0・success・空JSONだけを認めます。開始に対応するhook応答の欠落・故障・allow/updatedInput応答は受理しません。ただしCLIがそのイベントを出さない場合、ログ監査だけからガード実行の有無は確定できません。

## 品質と採点

構造監査の適合は内容の合格ではありません。子の不存在断定・鮮度基準の推測は `child_quality_signals` として返します。成果採点でも同種の記述は要人手確認です。これらは語句の検出で、意味・妥当性を完全に判定する仕組みではありません。

禁止主張・禁止数値の語句一致は全ケースで人手確認に統一し、肯定/否定/引用/仮説を正規表現で断定しません。点数は診断用に残し、`pass:false` を必ず維持します。スキーマ不合格・禁止根拠の参照・必要承認の欠落は従来どおり0点です。意味の審査は人間のレビューを必要とし、点数だけで採用しません。

## 回帰試験と残条件

合成プロトコルで、各必須行の欠落、全行session/UUID破損、ID不一致、順序逆転、偽完了、権限拒否、追加使用、hook故障、wire改変、二重委譲、子ツール、結果差替え、複数成果候補を拒否します。保存済み生ログ・実モデル回答・個人パスはfixtureに含めません。

この修正のレビュー後に必要なのは、最新利用枠と追加使用OFF確認、段階的な3担当/30合成ケース/親単独比較、実CLIによるローカル管理アプリの取込・採用/差し戻し・履歴までの統合検証です。本番には最終SHAのテスト・CI・全依存差分の独立レビューとfresh preflight、実D1バックアップ/復元確認、直前Versionのv2/chunks互換・復旧確認が別途必要です。
