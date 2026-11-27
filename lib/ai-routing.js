// Deterministic local routing only: never sends the request to a model.
export const ROUTING_VERSION=1;
const rules=[
 ['wholesale','団体・OEM・営業',/団体|OEM|卸売|営業|チーム提案/ig],
 ['profit_inventory','利益・在庫',/在庫|利益|原価|欠品|粗利/ig],
 ['ec','EC・商品ページ',/Amazon|EC|商品ページ|購入率/ig],
 ['marketing','広告・販促',/広告|販促|キャンペーン|ROAS|ACOS/ig],
 ['social','SNS',/SNS|Instagram|TikTok|リール|フォロワー/ig],
 ['creative','制作',/デザイン|画像|動画|バナー|制作/ig],
 ['market','顧客・市場',/市場|競合|顧客|アンケート/ig],
 ['growth','検証',/実験|検証|比較テスト/ig],
 ['coo','業務進行',/期限|担当タスク|進捗|優先順位|業務/ig]
];
export function routeRequest(title,objective){
 const text=(title+' '+objective).normalize('NFKC');
 const hits=rules.map(([role,label,pattern])=>({role,label,score:new Set((text.match(pattern)||[]).map(x=>x.toLowerCase())).size})).filter(x=>x.score).sort((a,b)=>b.score-a.score||a.role.localeCompare(b.role));
 const ambiguous=!hits.length||hits.length>1&&hits[0].score===hits[1].score;
 return {version:ROUTING_VERSION,method:'local_rules',primary:ambiguous?null:hits[0].role,collaborators:ambiguous?[]:hits.slice(1).map(x=>x.role),candidates:hits.map(x=>x.role),reason:!hits.length?'該当する業務分類がありません':ambiguous?'複数部署の根拠が同程度のため主担当の確認が必要です':hits.map(x=>x.label+': '+x.score+'種の一致').join(' / '),confirmed:false};
}
