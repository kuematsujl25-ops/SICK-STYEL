import {joinLink} from './meeting-agenda.js';
import {notesView} from './meeting-notes-ui.js';
import {meetingTypes,meetingType,usesZoom,assertTypeChange} from './meeting-policy.js';
import {hasOutstandingMeetings} from './org-meeting-lifecycle.js';
const labels={creating:'処理中・再操作しないでください',zoom_only:'Zoom作成済み・カレンダー未登録',synced:'Zoom・カレンダー登録済み',error:'一部失敗・要確認',uncertain:'結果不明・管理者の確認が必要'};
export const meetingContent=(o,kind)=>o[kind+'MeetingContent']||(kind==='initial'?'初回ZOOM':'活用法提案ZOOM');
export function meetingFormChanged(o,kind,values){return (values[kind+'MeetingType']!==undefined&&values[kind+'MeetingType']!==meetingType(o,kind))||values[kind+'MeetingContent']!==meetingContent(o,kind)||values[kind+'ZoomAt']!==(o[kind+'ZoomAt']||'')||Number(values[kind+'MeetingDurationMin'])!==(o[kind+'MeetingDurationMin']??45);}
export function saveMeetingFields(o,kind,values){
 if(!['initial','proposal'].includes(kind))throw Error('会議の種類が不正です');
 const duration=Number(values[kind+'MeetingDurationMin']);
 if(!Number.isInteger(duration)||duration<1||duration>1440)throw Error('所要時間は1〜1440分で指定してください');
 const content=String(values[kind+'MeetingContent']||'').trim(),at=values[kind+'ZoomAt'];
 if(!content||content.length>200||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at))throw Error('内容と開始日時を入力してください');
 const type=values[kind+'MeetingType']??meetingType(o,kind);if(!Object.hasOwn(meetingTypes,type))throw Error('会議種別が不正です');const next={...o,[kind+'MeetingType']:type};assertTypeChange(o,next);
 return {...next,[kind+'MeetingContent']:content,[kind+'ZoomAt']:at,[kind+'MeetingDurationMin']:duration,updatedAt:new Date().toISOString()};
}
export function renderMeetings(orgs,esc){
 const active=orgs.filter(o=>!o.deletedAt),recovery=orgs.filter(o=>o.deletedAt&&hasOutstandingMeetings(o));
 const rows=active.flatMap(o=>['initial','proposal'].filter(k=>o[k+'ZoomAt']||o[k+'ZoomUrl']||o[k+'MeetingSync']).map(kind=>({o,kind})));
 return `<section class="panel"><div class="panelhead"><h2>会議を準備</h2><button data-nav="orgSales">団体・OEM先を管理</button></div>${active.length?`<form id="meetingselect"><label>団体・OEM先<select name="orgId" required><option value="">団体を選択</option>${active.map(o=>`<option value="${esc(o.id)}">${o.partyType==='oem'?'OEM：':'団体：'}${esc(o.name)}</option>`).join('')}</select></label><label>会議枠（各団体2件まで）<select name="kind"><option value="initial">1件目</option><option value="proposal">2件目</option></select></label><button class="primary">内容・日時を指定</button></form>`:'<p>先に団体を登録してください。</p><button data-neworg>団体を追加</button>'}<details><summary>使い方・詳細</summary><p>内容と日時を保存し、Zoom作成、URL確認、カレンダー登録の順に進みます。同じ団体に準備済みの会議がある場合は、その会議を開きます。</p></details></section>
 <section class="panel"><h2>会議一覧</h2>${rows.length?rows.map(({o,kind})=>`<article class="listrow"><div class="grow"><b>${esc(o.name)}｜${esc(meetingContent(o,kind))}</b><small>${esc(o[kind+'ZoomAt']||'日時未設定')}（日本時間） · ${o[kind+'MeetingDurationMin']??45}分</small><span class="badge">${esc(labels[o[kind+'MeetingSync']?.status]||'未作成')}</span>${o[kind+'MeetingSync']?.error?`<p role="alert" class="red">${esc(o[kind+'MeetingSync'].error)}</p>`:''}</div>${!o[kind+'MeetingSync']?.cancelPending&&!['creating','uncertain','cancelled'].includes(o[kind+'MeetingSync']?.status)?joinLink(o[kind+'ZoomUrl'],esc):''}<button data-meetingorg="${esc(o.id)}" data-meetingkind="${kind}">会議を開く</button></article>`).join(''):'<p>会議はまだありません。</p>'}</section>
 ${recovery.length?`<section class="panel"><h2>確認が必要な会議</h2><p role="alert">削除済み団体に会議記録が残っています。復元して状態・取消を確認してください。</p>${recovery.map(o=>`<p>${esc(o.name)} <button data-restoreorg="${esc(o.id)}">団体を復元して会議を確認</button></p>`).join('')}</section>`:''}`;
}
export function renderMeetingEditor(o,kind,esc,connections){
 const sync=o[kind+'MeetingSync'],url=o[kind+'ZoomUrl']||'';
 const connected=connections?.zoomConnected&&connections?.calendarConnected;
 const ready=usesZoom(o,kind)&&!!o.id&&connected&&connections?.calendarIdentityReady!==false;
 return `<form id="meetingform"><div class="panelhead"><h2>${esc(o.name)}の会議</h2><button type="button" id="close" aria-label="閉じる">✕</button></div>
 ${usesZoom(o,kind)&&!connected?'<p role="alert" class="red">Zoom・Googleカレンダーの認可が必要です。設定で接続を確認してください。</p>':usesZoom(o,kind)&&connections?.calendarIdentityReady===false?'<p role="alert" class="red">主催カレンダー確認の追加承認・Google再認可が未完了です。設定で再認可してください。</p>':''}
 <div class="formfields"><label>会議種別<select name="${kind}MeetingType">${Object.entries(meetingTypes).map(([v,l])=>`<option value="${v}" ${meetingType(o,kind)===v?'selected':''}>${l}</option>`).join('')}</select></label><label>内容<input name="${kind}MeetingContent" required maxlength="200" value="${esc(meetingContent(o,kind))}"></label><label>開始日時（日本時間）<input name="${kind}ZoomAt" required type="datetime-local" value="${esc(o[kind+'ZoomAt']||'')}"></label><label>所要時間（分）<input name="${kind}MeetingDurationMin" required type="number" min="1" max="1440" step="1" value="${o[kind+'MeetingDurationMin']??45}"></label><label>Zoom参加URL（自動入力）<input type="text" readonly value="${esc(url)}" placeholder="Zoom作成後に自動入力"></label></div>
 ${!usesZoom(o,kind)?'<p role="note">この種別はアプリ内に保存します。Zoom URLは生成せず、外部予約・招待も行いません。</p>':''}
 <p class="badge">${esc(labels[sync?.status]||'未作成')}</p>${sync?.error?`<p class="red" role="alert">${esc(sync.error)}</p>`:''}
 ${!sync?.cancelPending&&!['creating','uncertain','cancelled'].includes(sync?.status)?joinLink(url,esc):''}
 <p class="note">Zoomの契約による時間制限は変わりません。</p><p>カレンダー登録時にゲストへ招待を送信します。更新・取消もゲストへ通知します。</p>
 <details><summary>使い方・詳細</summary><p>変更を保存してから次の操作へ進んでください。URLの手入力は不要です。</p></details>
 <div id="editerror" role="alert"></div><div class="actions">
 ${ready&&(!sync||(['error','zoom_only'].includes(sync.status)&&!sync.cancelPending))?`<button type="button" class="primary" data-mtgsync="${kind}:${sync?.zoomMeetingId?'create':'prepare'}">${sync?.zoomMeetingId?'URLを確認してカレンダー追加・招待':'確認してZoomを作成'}</button>`:''}
 ${ready&&sync?.status==='synced'?`<button type="button" data-mtgsync="${kind}:update">変更を確認して同期</button>`:''}
 ${sync?.status==='creating'?`<button type="button" data-mtgsync="${kind}:recover">中断した処理を確認（15分経過後）</button>`:''}
 ${sync&&sync.status!=='creating'?`<button type="button" class="red" data-mtgsync="${kind}:cancel">${sync.cancelPending?'取消を再試行':'MTGを取消'}</button>`:''}</div>
 ${notesView(o,kind,esc)}
 <div class="dialogactions"><button type="button" id="cancel">閉じる</button><button class="secondary" id="save">内容・日時を保存</button></div></form>`;
}
