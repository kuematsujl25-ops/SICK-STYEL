import {usesZoom} from './meeting-policy.js';
export const jstDate=(now=new Date())=>now.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
export function zoomJoinUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='zoom.us'||u.hostname.endsWith('.zoom.us'))&&/^\/(j|my)\//.test(u.pathname)?u.href:null;}catch{return null;}
}
export function meetingAgenda(orgs=[]){
 return orgs.filter(o=>!o.deletedAt).flatMap(o=>['initial','proposal'].flatMap(kind=>{
  const at=o[kind+'ZoomAt'];if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at))return [];
  const start=Date.parse(at+':00+09:00'),duration=o[kind+'MeetingDurationMin']??45;
  if(!Number.isFinite(start)||!Number.isInteger(duration)||duration<1||duration>1440)return [];
  const sync=o[kind+'MeetingSync'],blocked=!!sync?.cancelPending||['creating','uncertain','cancelled'].includes(sync?.status);
  return [{orgId:o.id,kind,title:o.name+'｜'+(o[kind+'MeetingContent']||(kind==='initial'?'初回ZOOM':'活用法提案ZOOM')),at,start,end:start+duration*60000,blocked,
   token:JSON.stringify([o.id,kind,at]),url:!blocked&&usesZoom(o,kind)?zoomJoinUrl(o[kind+'ZoomUrl']):null,
   status:sync?.cancelPending?'取消確認中':sync?.status==='creating'?'処理中':sync?.status==='uncertain'?'結果確認が必要':sync?.status==='cancelled'?'取消済み':sync?.status==='error'?'連携要確認':!usesZoom(o,kind)?'Zoomなし':o[kind+'ZoomUrl']?'Zoom作成済み':'Zoom未作成'}];
 })).sort((a,b)=>a.start-b.start||a.token.localeCompare(b.token));
}
export const dueMeetings=(orgs,now=new Date())=>meetingAgenda(orgs).filter(m=>!m.blocked&&m.start>now.getTime()&&m.start-now.getTime()<=600000);
export function meetingTime(m){
 const format=n=>new Date(n).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false});
 return format(m.start)+'〜'+(jstDate(new Date(m.start))!==jstDate(new Date(m.end))?'翌日 ':'')+format(m.end);
}
export function joinLink(value,esc){const url=zoomJoinUrl(value);return url?`<div class="meeting-join"><a class="button primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Zoomに参加 ↗</a><a class="meeting-url" href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(url)}</a></div>`:'';}
export function renderTodayMeetings(orgs,esc,now=new Date()){
 const day=jstDate(now),start=Date.parse(day+'T00:00:00+09:00');
 const rows=meetingAgenda(orgs).filter(m=>m.start<start+86400000&&m.end>start);
 return `<section class="panel today-meetings"><div class="panelhead"><h2>今日の会議 <small>${esc(day)} · 日本時間</small></h2><a href="/?meetings=1">会議一覧へ</a></div><p class="note">アプリに保存された予定。前日から続く会議も表示します。</p>${rows.length?rows.map(m=>`<article class="meeting-card"><div><span class="badge">${m.blocked?esc(m.status):m.end<=now.getTime()?'終了':m.start<=now.getTime()?'予定時間内':'予定'}</span><strong>${esc(meetingTime(m))}</strong>${m.start<start?'<small>前日開始</small>':''}<h3>${esc(m.title)}</h3><small>${esc(m.status)}</small></div>${m.url?joinLink(m.url,esc):'<p class="note">'+(m.blocked?'会議一覧で状態を確認してください。':m.status==='Zoomなし'?'Zoomを使用しない予定です。':'参加URLはまだ利用できません。会議一覧で確認してください。')+'</p>'}</article>`).join(''):'<p class="empty">今日の会議はありません。</p>'}<p class="note">開始10分前からアプリ内に表示します。閉じている間の通知は「設定・バックアップ」でこの端末の通知登録が必要です。配信・端末の状況で遅れる場合があります。</p></section>`;
}
export function renderMeetingReminder(orgs,esc,now=new Date()){
 const due=dueMeetings(orgs,now);return due.length?`<section class="meeting-reminder" role="status"><b>まもなく会議が始まります</b>${due.map(m=>`<p>${esc(m.title)} · ${esc(meetingTime(m))}（あと${Math.ceil((m.start-now.getTime())/60000)}分）</p>`).join('')}<a href="/?meetings=1">会議と参加リンクを確認</a></section>`:'';
}
