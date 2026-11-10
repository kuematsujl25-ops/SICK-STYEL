export const meetingTypes={initial_zoom:'初回 Zoom',proposal_zoom:'活用提案 Zoom',other:'その他（Zoomなし）'};
export const meetingType=(org,kind)=>org[kind+'MeetingType']??(kind==='initial'?'initial_zoom':'proposal_zoom');
export const usesZoom=(org,kind)=>['initial_zoom','proposal_zoom'].includes(meetingType(org,kind));
export function assertTypeChange(previous,next){
 for(const kind of ['initial','proposal'])if(meetingType(previous,kind)!==meetingType(next,kind)&&(previous[kind+'MeetingSync']||previous[kind+'ZoomUrl']))throw Error('既存URL・連携記録がある会議の種別は変更できません。取消・確認を先に完了してください');
}

// Routing hint only: copied titles can match Notta's allowlist; this is not proof of origin.
export const NOTTA_ROUTING='calendar-title-v1';
export const NOTTA_MARKER='[SSM-NOTTA-7C4F2A]';
export const NOTTA_NOTICE='Nottaによる録音・文字起こしを予定しています。主催者は参加者へ事前案内し、当日の同意を確認してから録音を許可してください。';
export function nottaMeetingPlan(org,kind){
 const sync=org[kind+'MeetingSync'];
 const routed=sync?.nottaRouting===NOTTA_ROUTING||(!sync&&!org[kind+'ZoomUrl']);
 const title=`${org.name}｜${org[kind+'MeetingContent']||(kind==='initial'?'初回ZOOM':'活用法提案ZOOM')}`;
 if(title.includes(NOTTA_MARKER))throw Error('会議名・団体名にNotta専用識別タグを入力しないでください');
 return {nottaRouting:routed?NOTTA_ROUTING:null,summary:(routed?NOTTA_MARKER+' ':'')+title,
  description:'SICKSTYLE 団体営業商談。本アプリの団体営業画面から自動作成されました。'+(routed?'\n'+NOTTA_NOTICE:'')};
}
