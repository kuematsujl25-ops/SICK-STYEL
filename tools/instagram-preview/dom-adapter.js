import {validateBatch} from './model.js';
// Read-only adapter for explicitly bound, visible DOM elements.
// It does not discover tabs, request permissions, execute scripts, or transfer data.
// Live Instagram bindings remain unverified. Do not infer selectors from these fixtures.
const handle = link => {
 const raw=link?.getAttribute('href');
 if(typeof raw!=='string')throw Error('プロフィールリンク未確認');
 const match=raw.match(/^(?:https:\/\/www\.instagram\.com)?\/([a-zA-Z0-9._]{1,30})\/$/);
 if(!match||['direct','explore','reels','accounts','p'].includes(match[1].toLowerCase()))throw Error('プロフィールリンク未確認');
 return match[1].toLowerCase();
};
const visible = element => {
 const r=element?.getBoundingClientRect();
 return !!r&&r.width>0&&r.height>0&&element.getAttribute('aria-hidden')!=='true';
};
function activityDate(label, article, timeZoneConfirmed) {
 // Never use dates found in message text, tooltips, URLs, or relative weekday labels.
 if(!timeZoneConfirmed||!visible(label)||label===article||article.contains(label)||label.contains(article))return null;
 const match=(label.textContent||'').trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})$/);
 if(!match||Number(match[4])>23||Number(match[5])>59)return null;
 const date=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
 return Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:null;
}
function direction(article,row){
 const a=article.getBoundingClientRect(),r=row.getBoundingClientRect();
 if(!visible(row)||a.width>=r.width*0.85||a.left<r.left||a.right>r.right)return 'unknown';
 const left=Math.abs(a.left-r.left)<=12,right=Math.abs(a.right-r.right)<=12;
 return left&&!right?'inbound':right&&!left?'outbound':'unknown';
}
export function collectBoundConversationBatches({ownerLink,peerLink,messages},scope){
 if(!visible(ownerLink)||!visible(peerLink)||!Array.isArray(messages)||messages.length>100)throw Error('表示範囲未確認');
 const owner=handle(ownerLink),account=handle(peerLink);
 if(owner===account)throw Error('会話相手未確認');
 const events=[];let firstVisibleOutbound=false;
 for(const {article,row,dateLabel} of messages){
  if(!visible(article)||!row?.contains(article))continue;
  const dir=direction(article,row),date=activityDate(dateLabel,article,scope.timeZone==='Asia/Tokyo');
  // Body is used only for a coarse invitation candidate and never returned or stored.
  const mentionsZoom=/\bzoom\b/i.test(article.textContent||'');
  const add=(type,evidence,reason)=>events.push({account,type,date,direction:dir,historyStartSeen:false,firstOutboundConfirmed:false,evidence,verified:false,reason,party:''});
  if(dir==='inbound')add('reply','received_message',date?'':'date_unknown');
  if(dir==='outbound'&&!firstVisibleOutbound){add('new_dm','unknown','history_incomplete');firstVisibleOutbound=true;}
  if(mentionsZoom&&dir!=='inbound')add('zoom_invite','ambiguous_zoom',dir==='unknown'?'direction_unknown':'ambiguous_invitation');
 }
 // Allowlist construction: no input spread, text, URL, attachments, selectors, or raw DOM.
 const batches=[];
 for(let offset=0;offset<Math.max(events.length,1);offset+=100){
  batches.push(validateBatch({version:1,owner,source:'browser_observation',capturedAt:scope.capturedAt,rangeStart:scope.rangeStart,rangeEnd:scope.rangeEnd,coverage:'partial',events:events.slice(offset,offset+100)}));
 }
 return batches;
}
