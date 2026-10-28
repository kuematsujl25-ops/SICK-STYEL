import {NOTTA_NOTICE} from './meeting-policy.js';
// All values are text nodes: meeting names and provider values never become HTML.
export function confirmMeetingPlan(plan){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','会議の確認');
  const title=document.createElement('h2');title.textContent='会議の確認';dialog.append(title);
  const operation=plan.action==='prepare'?'Zoomのみ作成（招待はまだ送りません）':plan.action==='cancel'?'Zoom・予定を削除し、ゲストへ取消通知':plan.action==='update'?'日時・内容を更新し、ゲストへ更新通知':'カレンダーへ登録し、ゲストへ招待を送信';
  const warning=document.createElement('p');warning.textContent=operation;warning.setAttribute('role','note');dialog.append(warning);
  for(const [label,value] of [['予定名',plan.summary],['日時',plan.start+'（日本時間・'+(plan.duration??45)+'分）'],['Zoomホスト',plan.zoomHost],['Calendar主催者',plan.calendarId],['ゲスト',plan.attendees.join(', ')],['Zoom URL',plan.zoomUrl||'作成後に発行・招待前に再確認']]){
   const row=document.createElement('p'),heading=document.createElement('strong'),text=document.createElement('span');
   heading.textContent=label+'：';text.textContent=value;row.style.overflowWrap='anywhere';row.append(heading,text);dialog.append(row);
  }
  const notta=document.createElement('p');notta.textContent=(plan.nottaRouting?NOTTA_NOTICE+' ':'')+'Notta参加予約はこのアプリでは確認できません。作成・変更・取消後はNottaの対象予定を確認してください。識別タグはNotta側の許可リスト設定後に対象判定に使われます。';dialog.append(notta);
  const actions=document.createElement('div');actions.className='dialogactions';
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
  for(const [label,value] of [['閉じる',false],['戻る',false],['確認して実行',true]]){
   const button=document.createElement('button');button.type='button';button.textContent=label;
   if(value)button.className=plan.action==='cancel'?'red':'primary';
   button.onclick=()=>finish(value);actions.append(button);
  }
  dialog.append(actions);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.onclose=()=>finish(false);
  document.body.append(dialog);dialog.showModal();
 });
}
