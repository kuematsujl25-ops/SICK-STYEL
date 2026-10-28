import {validateNotes} from './meeting-notes.js';
import {validMeetingDuration} from './meeting-duration.js';
export const STAFF_ASSIGNEES=['入戸野','竹田','植松'];
export const STAFF_TASK_STATUS=['未着手','進行中','確認待ち','完了'];
export const ORG_STAGES=['DM送信','初回ZOOM予約','初回ZOOM実施','サンプル発送','到着確認','試用確認','活用法提案ZOOM予約','活用法提案ZOOM実施','有償導入','継続購入'];
export const ORG_SIDE_STAGES=['返信待ち','保留','失注','連絡不要'];
export const ORG_ALL_STAGES=[...ORG_STAGES,...ORG_SIDE_STAGES];
export const COLLECTION_CATEGORIES=['商品・利益','購入者','営業','SNS'];
export const COLLECTION_STATUS=['未収集','確認中','収集済み'];
export const REEL_PLATFORMS=['Instagram','TikTok','YouTube'];
export const REEL_FORMATS=['解説','実演','選手紹介','その他'];
export const EXPERIMENT_STATUS=['仮説検証中','検証済み','保留'];
export const PLAYER_LEAGUES=['Jリーグ','海外'];
export const PLAYER_TIERS=['候補','提供済み','憧れ枠','相談可能性枠'];
export const PLAYER_PRIORITY=['高','中','低'];
export const PLAYER_SAMPLE_STATUS=['未提供','提供準備中','提供済み'];
export const MEETING_SYNC_STATUS=['creating','zoom_only','synced','error','uncertain'];
export const AD_PLATFORMS=['Amazon','Instagram'];
export const AD_SOURCES=['manual','csv'];
const NEW_COLLECTIONS=['staffTasks','orgSales','collectionTasks','reelPosts','growthExperiments','competitorAccounts','playerCandidates','adMetrics'];
export const empty=()=>({goals:[],tasks:[],shipments:[],metrics:[],staffTasks:[],orgSales:[],collectionTasks:[],reelPosts:[],growthExperiments:[],competitorAccounts:[],playerCandidates:[],adMetrics:[],brand:{理念:"",起源:"",Mission:"",Vision:"",Values:""},integrations:{amazon:{mode:"manual"},instagram:{mode:"manual"}}});
// 旧データ（新項目が存在しない保存済み文書・バックアップ）に限り、NEW_COLLECTIONSの欠落（undefined）キーだけを
// []で補う。検証はしない。元からある必須項目（goals/tasks/.../brand/integrations）は一切補完しない —
// ここでempty()を丸ごと下敷きにすると、null・{}・{revision:N}のような壊れた/不完全な入力までもが
// 「新しい空のワークスペース」としてvalidate()を通過してしまい、/api/data や /api/restore 経由で
// 本番の業務データを無言で空に上書きできてしまう（Codex独立レビュー指摘のP1）。
// 呼び出し側（store.doc('workspace')が存在しない場合）は、ここではなく明示的にempty()自体を渡すこと。
export const migrate=d=>{
 const base=d&&typeof d==='object'&&!Array.isArray(d)?d:{};
 const fill=k=>base[k]===undefined?[]:base[k];
 return {...base,...Object.fromEntries(NEW_COLLECTIONS.map(k=>[k,fill(k)]))};
};
export function validate(input){
 const bad=()=>{throw Error('データの形式が正しくありません');};
 const d=migrate(input);
 if(!['goals','tasks','shipments','metrics',...NEW_COLLECTIONS].every(k=>Array.isArray(d[k])&&d[k].length<=10000)||!d.brand||typeof d.brand!=='object'||Array.isArray(d.brand))bad();
 const text=(v,max=10000)=>typeof v==='string'&&v.length<=max;
 const date=v=>text(v,10)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 const ndate=v=>v===''||date(v);
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e12;
 const nnum=v=>v===null||num(v);
 const nint=v=>v===null||(Number.isInteger(v)&&v>=0&&v<=1e12);
 const timestamp=v=>text(v,30)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 const ntimestamp=v=>v===null||timestamp(v);
 const optionalUrl=v=>v===undefined||v===''||text(v,2000)&&/^https:\/\//i.test(v);
 const optionalLocalTime=v=>v===undefined||v===''||text(v,16)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+':00+09:00'));
 const nullableTimestamp=v=>v===undefined||v===null||timestamp(v);
 // Zoom/Googleカレンダー自動連携の同期ステータス。未接続・未作成ならnull/undefined（二重会議作成防止のため、作成成功後だけ値を持つ）。
 const validMeetingSync=v=>v===undefined||v===null||(v&&typeof v==='object'&&text(v.requestId,100)&&v.requestId&&(v.zoomMeetingId===null||text(v.zoomMeetingId,200))&&(v.calendarEventId===null||text(v.calendarEventId,500))&&(v.calendarId===undefined||text(v.calendarId,320))&&(v.zoomHostId===undefined||text(v.zoomHostId,200))&&(v.attendees===undefined||(Array.isArray(v.attendees)&&v.attendees.length<=20&&v.attendees.every(x=>typeof x==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)&&x.length<=320)))&&(v.operationId===undefined||text(v.operationId,100))&&(v.nottaRouting===undefined||v.nottaRouting==='calendar-title-v1')&&MEETING_SYNC_STATUS.includes(v.status)&&(v.cancelPending===undefined||typeof v.cancelPending==='boolean')&&(v.error===null||text(v.error,2000))&&timestamp(v.updatedAt));
 for(const k of ['理念','起源','Mission','Vision','Values'])if(!text(d.brand[k]))bad();
 for(const k of ['goals','tasks','shipments','metrics',...NEW_COLLECTIONS]){
  const ids=new Set();
  for(const r of d[k]){
   if(!r||typeof r!=='object'||!text(r.id,100)||!r.id||ids.has(r.id))bad();ids.add(r.id);
   if(!['orgSales','competitorAccounts','playerCandidates','adMetrics'].includes(k)&&k!=='metrics'&&(!text(r.title,500)||!r.title.trim()))bad();
   if(r.notes!==undefined&&!text(r.notes))bad();
   if(k==='goals'&&(!['monthly','final'].includes(r.type)||!num(r.current)||!num(r.target)||r.target<=0||!text(r.unit,500)||!text(r.month,7)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.month)))bad();
   if(k==='tasks'&&(!date(r.due)||!['高','中','低'].includes(r.priority)||typeof r.done!=='boolean'))bad();
   if(k==='shipments'&&(!date(r.due)||!['未発送','準備中','発送済み','配達完了'].includes(r.status)||!['order','recipient','carrier','tracking'].every(x=>text(r[x],500))))bad();
   if(k==='metrics'&&(!date(r.date)||!['sales','orders','followers','reach','engagement'].every(x=>num(r[x]))||!['orders','followers','reach','engagement'].every(x=>Number.isInteger(r[x]))))bad();
   if(k==='staffTasks'&&(!['',...STAFF_ASSIGNEES].includes(r.assignee)||!date(r.due)||!['高','中','低'].includes(r.priority)||!STAFF_TASK_STATUS.includes(r.status)||!['relatedOrg','relatedPlayer','relatedPost','nextAction'].every(x=>text(r[x],500))||!timestamp(r.updatedAt)||!ntimestamp(r.deletedAt===undefined?null:r.deletedAt)))bad();
   if(k==='orgSales'){for(const f of ['desiredQty','proposedQty','confirmedQty'])if(r[f]!==undefined&&!nint(r[f]))bad();if(r.partyType!==undefined&&!['organization','oem'].includes(r.partyType))bad();for(const kind of ['initial','proposal'])if(r[kind+'MeetingType']!==undefined&&!['initial_zoom','proposal_zoom','other'].includes(r[kind+'MeetingType']))bad();validateNotes(r.meetingNotes);}
   if(k==='orgSales'&&(!text(r.name,200)||!r.name.trim()||!ORG_ALL_STAGES.includes(r.stage)||!['',...STAFF_ASSIGNEES].includes(r.assignee)||!text(r.category,200)||!text(r.size,200)||!text(r.contact,500)||!(r.initialMeetingContent===undefined||text(r.initialMeetingContent,200))||!(r.proposalMeetingContent===undefined||text(r.proposalMeetingContent,200))||!(r.initialMeetingDurationMin===undefined||validMeetingDuration(r.initialMeetingDurationMin))||!(r.proposalMeetingDurationMin===undefined||validMeetingDuration(r.proposalMeetingDurationMin))||!optionalLocalTime(r.initialZoomAt)||!optionalUrl(r.initialZoomUrl)||!optionalLocalTime(r.proposalZoomAt)||!optionalUrl(r.proposalZoomUrl)||!validMeetingSync(r.initialMeetingSync)||!validMeetingSync(r.proposalMeetingSync)||!nnum(r.sampleQty)||!nnum(r.sampleCost)||!nnum(r.shippingCost)||!nnum(r.trialUsers)||!text(r.feedback,2000)||!text(r.proposal,2000)||!nnum(r.paidQty)||!nnum(r.paidRevenue)||!nnum(r.paidCost)||!text(r.lostReason,2000)||!text(r.nextAction,500)||!(r.nextDue===''||date(r.nextDue))||!timestamp(r.updatedAt)||!ntimestamp(r.deletedAt===undefined?null:r.deletedAt)||!Array.isArray(r.history)||r.history.length>500||!r.history.every(h=>h&&typeof h==='object'&&ORG_ALL_STAGES.includes(h.stage)&&timestamp(h.at)&&text(h.note,500))))bad();
   if(k==='collectionTasks'&&(!COLLECTION_CATEGORIES.includes(r.category)||!['',...STAFF_ASSIGNEES].includes(r.assignee)||!ndate(r.due)||!text(r.period,200)||!text(r.source,500)||!text(r.frequency,200)||!text(r.purpose,1000)||!COLLECTION_STATUS.includes(r.status)||!text(r.value,2000)||!timestamp(r.updatedAt)))bad();
   if(k==='reelPosts'&&(!REEL_PLATFORMS.includes(r.platform)||!text(r.url,2000)||!date(r.postedAt)||!nint(r.durationSec)||!text(r.theme,500)||!text(r.hook,500)||!REEL_FORMATS.includes(r.format)||!text(r.cta,500)||!text(r.product,500)||!text(r.campaignId,200)||!timestamp(r.observedAt)||!['views','reach','saves','shares','comments','followersGained','profileVisits','linkClicks'].every(x=>nint(r[x]))||!nnum(r.avgWatchSec)||!(r.retentionPct===null||typeof r.retentionPct==='number'&&Number.isFinite(r.retentionPct)&&r.retentionPct>=0&&r.retentionPct<=100)))bad();
   if(k==='growthExperiments'&&(!text(r.hypothesis,2000)||!text(r.relatedPosts,1000)||!text(r.targetProduct,500)||!text(r.cta,500)||!text(r.trackingLink,2000)||!ndate(r.periodStart)||!ndate(r.periodEnd)||!text(r.metricsWatched,1000)||!text(r.result,2000)||!text(r.nextAction,500)||!nint(r.measuredPurchases)||!text(r.unmeasuredNote,1000)||!EXPERIMENT_STATUS.includes(r.status)||!timestamp(r.updatedAt)))bad();
   if(k==='competitorAccounts'&&(!text(r.accountName,200)||!r.accountName.trim()||!REEL_PLATFORMS.includes(r.platform)||!text(r.profileUrl,2000)||!text(r.postUrl,2000)||!text(r.genre,200)||!date(r.observedAt)||!nint(r.followers)||!nint(r.publicViews)||!text(r.reaction,2000)||!text(r.referencePoint,2000)||!text(r.ownIdea,2000)))bad();
   if(k==='adMetrics'&&(!AD_PLATFORMS.includes(r.platform)||!date(r.periodStart)||!date(r.periodEnd)||r.periodEnd<r.periodStart||!(r.attributionWindowDays===null||Number.isInteger(r.attributionWindowDays)&&r.attributionWindowDays>=0&&r.attributionWindowDays<=365)||!nnum(r.adCost)||!nnum(r.attributedSales)||!AD_SOURCES.includes(r.source)||!text(r.campaign,200)||!timestamp(r.updatedAt)))bad();
   if(k==='playerCandidates'&&(!text(r.name,200)||!r.name.trim()||!PLAYER_LEAGUES.includes(r.league)||!PLAYER_TIERS.includes(r.tier)||!text(r.affiliation,200)||!text(r.position,100)||!text(r.profileUrl,2000)||!text(r.videoUrl,2000)||!optionalUrl(r.photoUrl)||!(r.photoCredit===undefined||text(r.photoCredit,500))||!optionalUrl(r.photoSourceUrl)||!optionalUrl(r.sourceUrl)||!(r.successfulPer90===undefined||nnum(r.successfulPer90))||!(r.feintCount===undefined||nint(r.feintCount))||!nint(r.dribbleAttempts)||!(r.successRate===null||typeof r.successRate==='number'&&Number.isFinite(r.successRate)&&r.successRate>=0&&r.successRate<=1)||!nint(r.playTimeMin)||!text(r.period,200)||!text(r.source,500)||!text(r.brandFitReason,2000)||!text(r.confirmItems,2000)||!text(r.negotiationStatus,1000)||!(r.priority===undefined||PLAYER_PRIORITY.includes(r.priority))||!(r.sampleStatus===undefined||PLAYER_SAMPLE_STATUS.includes(r.sampleStatus))||!(r.homepageStatus===undefined||['非掲載','掲載候補','公開済み'].includes(r.homepageStatus))||(r.homepageStatus&&r.homepageStatus!=='非掲載'&&r.tier!=='提供済み')||!nullableTimestamp(r.updatedAt===undefined?null:r.updatedAt)))bad();
  }
 }
 if(new Set(d.metrics.map(m=>m.date)).size!==d.metrics.length)bad();
 return Object.fromEntries([...['goals','tasks','shipments','metrics',...NEW_COLLECTIONS].map(k=>[k,d[k]]),['brand',d.brand],['integrations',empty().integrations]]);
}
