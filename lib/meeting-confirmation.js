import {encrypt,decrypt} from './security.js';
import * as zoom from '../integrations/zoom.js';
import * as calendar from '../integrations/googlecalendar.js';
import {syncMeeting} from './meeting-sync.js';
const organizer='k.uematsu.jl25@gmail.com';
const guests=['genta257601@gmail.com','sho62626s@gmail.com'];
export async function previewMeeting(store,{orgId,kind,action,revision},policy={organizer,guests}){
 if(!['initial','proposal'].includes(kind)||!['prepare','create','update','cancel'].includes(action))throw Error('会議操作が不正です');
 const row=await store.doc('workspace');
 if(!row||row.revision!==revision)throw Object.assign(Error('最新のデータを再読み込みしてください'),{conflict:true});
 const org=JSON.parse(row.body).orgSales.find(o=>o.id===orgId);
 if(!org||org.deletedAt)throw Error('対象の団体がありません');
 const sync=org[kind+'MeetingSync'];
 const content=org[kind+'MeetingContent']||(kind==='initial'?'初回ZOOM':'活用法提案ZOOM');
 if(action!=='cancel'&&!org[kind+'ZoomAt'])throw Error('開始日時を保存してください');
 if(action==='create'&&!sync?.zoomMeetingId)throw Error('先にZoomを作成し、発行されたURLを確認してください');
 // Verify calendar first, so missing authorization never creates a Zoom meeting.
 const c=action==='cancel'&&!sync?.calendarEventId?{calendarId:sync?.calendarId||policy.organizer}:await calendar.verifyOrganizer(store,policy.organizer);
 const z=action==='cancel'&&!sync?.zoomMeetingId?{userId:sync?.zoomHostId||null,email:'取消対象なし'}:await zoom.verifyHost(store);
 if(sync?.zoomMeetingId&&(!sync.zoomHostId||sync.zoomHostId!==z.userId))throw Error('既存会議のZoom所有者を確認できません。管理者が元の接続先を確認してください');
 if(sync?.calendarEventId&&(!sync.calendarId||sync.calendarId!==c.calendarId))throw Error('既存予定の主催カレンダーを確認できません。元の接続先を確認してください');
 const plan={orgId,kind,action,revision,summary:org.name+'｜'+content,start:org[kind+'ZoomAt'],duration:45,
  zoomUrl:org[kind+'ZoomUrl']||null,zoomHost:z.email,zoomHostId:z.userId,calendarId:c.calendarId,attendees:sync?.attendees||policy.guests};
 return {...plan,confirmation:encrypt({...plan,expires:Date.now()+300000})};
}
export async function confirmMeeting(store,input,policy){
 let approved;try{approved=decrypt(input.confirmation);}catch{throw Error('会議の確認画面から操作してください');}
 if(!approved||approved.expires<Date.now())throw Error('確認の期限が切れました。再確認してください');
 const current=await previewMeeting(store,input,policy);
 const {confirmation,...plan}=current;const {expires,...previous}=approved;
 if(JSON.stringify(plan)!==JSON.stringify(previous))throw Error('日時・内容・接続先が変わりました。再確認してください');
 return syncMeeting(store,{...input,meetingOptions:{summary:plan.summary,calendarId:plan.calendarId,zoomHostId:plan.zoomHostId,attendees:plan.attendees}});
}
