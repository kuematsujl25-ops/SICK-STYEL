export const meetingTypes={initial_zoom:'初回 Zoom',proposal_zoom:'活用提案 Zoom',other:'その他（Zoomなし）'};
export const meetingType=(org,kind)=>org[kind+'MeetingType']??(kind==='initial'?'initial_zoom':'proposal_zoom');
export const usesZoom=(org,kind)=>['initial_zoom','proposal_zoom'].includes(meetingType(org,kind));
export function assertTypeChange(previous,next){
 for(const kind of ['initial','proposal'])if(meetingType(previous,kind)!==meetingType(next,kind)&&(previous[kind+'MeetingSync']||previous[kind+'ZoomUrl']))throw Error('既存URL・連携記録がある会議の種別は変更できません。取消・確認を先に完了してください');
}
