// Google Calendar「予定作成画面」を開くための事前入力URL。自動登録やZoom会議の発行は行わない。
export function googleCalendarDraft(org,kind){
 const at=kind==='intro'?org.initialZoomAt:org.proposalZoomAt;
 const url=kind==='intro'?org.initialZoomUrl:org.proposalZoomUrl;
 if(typeof at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at))return null;
 const start=new Date(at+':00+09:00');
 if(!Number.isFinite(start.getTime())||start.toISOString()<'2000-01-01')return null;
 const fmt=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
 const end=new Date(start.getTime()+45*60000);
 const params=new URLSearchParams({action:'TEMPLATE',text:'SICKSTYLE｜'+(kind==='intro'?'初回ZOOM':'活用法提案ZOOM')+'｜'+org.name,dates:fmt(start)+'/'+fmt(end),ctz:'Asia/Tokyo',details:((typeof url==='string'&&/^https:\/\//.test(url))?url+'\n':'')+'SICKSTYLE 団体営業商談。内容と参加者を確認して保存してください。'});
 return 'https://calendar.google.com/calendar/render?'+params.toString();
}
