import {assertTypeChange} from './meeting-policy.js';
// Unknown/in-flight results must stay accessible until reconciled and canceled.
export function hasOutstandingMeetings(org){
 return ['initial','proposal'].some(kind=>{const s=org?.[kind+'MeetingSync'];return !!s&&(!!s.zoomMeetingId||!!s.calendarEventId||s.status!=='none'||s.cancelPending);});
}
export function assertMeetingRecordsRetained(previous,next){
 for(const o of next.orgSales||[])if(!previous.orgSales?.some(x=>x.id===o.id)&&o.meetingNotes?.length)throw Error('議事録は専用の保存操作を使ってください');
 for(const org of previous.orgSales||[]){
  const candidate=next.orgSales.find(x=>x.id===org.id);if(candidate){if(org.meetingNotes?.length&&!org.deletedAt&&candidate.deletedAt)throw Error('議事録が残っている対象は削除できません');assertTypeChange(org,candidate);if(JSON.stringify(org.meetingNotes||[])!==JSON.stringify(candidate.meetingNotes||[]))throw Error('議事録は専用の保存・取消操作を使ってください');}else if(org.meetingNotes?.length)throw Error('議事録が残っている対象は削除できません');
  if(!hasOutstandingMeetings(org))continue;
  const retained=next.orgSales.find(x=>x.id===org.id);
  if(!retained||(!org.deletedAt&&retained.deletedAt)||['initial','proposal'].some(k=>JSON.stringify(org[k+'MeetingSync']??null)!==JSON.stringify(retained[k+'MeetingSync']??null)))
   throw Error('会議の連携記録が残っています。先にMTGを取消し、完了を確認してから団体を削除してください。結果不明・処理中の場合は管理者が接続先を確認してください');
 }
}
