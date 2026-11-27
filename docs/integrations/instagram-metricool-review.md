# Instagramの投稿分析・予約確認（Metricool）
 
1. Claude Code の Metricool MCP で対象アカウント、過去30日（JST）のリール実績と、これから30日の予約を読み取る。
2. 下記形式を `metricool-review.json` として書き出す。予約IDはMetricoolが返した識別子、`url` は取得できた公式Plannerリンクのみ。空欄の指標に 0 を補わない。未取得の区画は null、確認済みで予約がない区画は `posts: []`。
3. 管理アプリの「Instagram」→「投稿分析・予約確認」でファイルを取り込む。マネージャーに保存した時点ではなく、Metricool取得時点を表示する。
 
```json
{
  "version": 1,
  "source": "metricool",
  "account": "demo_business",
  "observedAt": "2026-01-02T09:00:00+09:00",
  "analysis": {
    "from": "2025-12-03", "to": "2026-01-01", "reelCount": 4,
    "medianViews": 700, "medianReach": 620, "saves": null, "shares": 8,
    "findings": ["同形式の投稿のみ比較した。"], "recommendations": ["冒頭の見出しを比較する。"]
  },
  "planner": {
    "from": "2026-01-02T09:00:00+09:00", "to": "2026-02-01T09:00:00+09:00",
    "posts": [
      {"id":"demo-42","at":"2026-01-03T20:00:00+09:00","type":"reel","caption":"表示例","url":null}
    ]
  }
}
```
 
形式は reel / carousel / image / story / unknown。分析は同じ対象のリールについて計算し、中央値が整数でない場合は四捨五入。予約は未公開のInstagram予約だけを扱う。投稿・予約の作成・変更・確認用素材のアップロードはこの機能の対象外。Instagram公式連携やDM集計には影響しない。MCPはClaude Codeに接続されたまま使用し、アプリには認証情報を入れない。この連携は定時の自動同期ではなく、取得したJSONを取り込む方式。
