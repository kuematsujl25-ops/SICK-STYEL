// Review signals, not a natural-language truth/negation classifier.
export const QUALITY_INSTRUCTIONS=[
  '根拠がないことと、対象が存在しないことを区別してください。利益を確認できないときは「利益を評価できない」とし、「利益が見込める施策はない」と断定しないでください。',
  '鮮度の許容日数・更新周期・合格基準は、入力に明記された根拠がなければ未確認です。観測日時は報告できますが、月次なので許容範囲などの基準を作らないでください。',
  '否定・引用・仮説は確認済みの事実と明確に分けてください。推奨は確認済み根拠と不足条件を示し、未確認の効果を保証しないでください。'
].join('\n');

export function qualitySignals(text){
  const rules=[
    ['absence_from_missing_evidence',/(?:利益|効果|収益|収益性|有効性)[^。\n]{0,35}(?:施策|対策|方法|選択肢)[^。\n]{0,12}(?:存在しない|ありません|ない|ゼロ|0件)/u],
    ['absence_from_missing_evidence',/(?:施策|対策|方法|選択肢)[^。\n]{0,20}(?:全くない|存在しない|一つもない|ありません)/u],
    ['invented_freshness_threshold',/(?:鮮度|月次|週次|日次|データ|観測|更新)[^。\n]{0,45}(?:許容範囲|許容でき|問題ない|問題ありません|十分新し|十分に新し|有効と判断|基準を満た)/u],
    ['invented_freshness_threshold',/(?:\d+|[一二三四五六七八九十]+)(?:日|週間|か月|ヶ月|月)以内(?:なら|であれば)[^。\n]{0,25}(?:有効|十分|許容|新鮮)/u],
  ];
  return [...new Set(rules.filter(([,pattern])=>pattern.test(text)).map(([name])=>name))];
}
