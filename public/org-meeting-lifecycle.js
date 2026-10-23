// Unknown/in-flight results must stay accessible until reconciled and canceled.
export function hasOutstandingMeetings(org){
 return ['initial','proposal'].some(kind=>{const s=org?.[kind+'MeetingSync'];return !!s&&(!!s.zoomMeetingId||!!s.calendarEventId||s.status!=='none'||s.cancelPending);});
}
export function assertMeetingRecordsRetained(previous,next){
 for(const org of previous.orgSales||[]){
  if(!hasOutstandingMeetings(org))continue;
  const retained=next.orgSales.find(x=>x.id===org.id);
  if(!retained||(!org.deletedAt&&retained.deletedAt)||['initial','proposal'].some(k=>JSON.stringify(org[k+'MeetingSync']??null)!==JSON.stringify(retained[k+'MeetingSync']??null)))
   throw Error('会議の連携記録が残っています。先にMTGを取消し、完了を確認してから団体を削除してください。結果不明・処理中の場合は管理者が接続先を確認してください');
 }
}
