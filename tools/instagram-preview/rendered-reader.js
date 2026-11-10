// Self-contained read-only DOM function for the supported browser evaluator.
// No API, credentials, network, storage, mutation, or automatic navigation.
export function readVisibleConversation(scope,dom=document,style=getComputedStyle){
 const validHandle=v=>typeof v==='string'&&/^[a-z0-9._]{1,30}$/.test(v);
 const day=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 if(!scope||!validHandle(scope.owner)||!day(scope.rangeStart)||!day(scope.rangeEnd)||scope.rangeStart>scope.rangeEnd||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(scope.capturedAt)||!Number.isFinite(Date.parse(scope.capturedAt)))throw Error('invalid_scope');
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.getAttribute('aria-hidden')!=='true';};
 const headings=[...dom.querySelectorAll('h1,h2,[role="heading"]')].filter(visible);
 if(!headings.some(e=>e.textContent.trim()===scope.owner))throw Error('owner_not_confirmed');
 const main=dom.querySelector('main');if(!main)throw Error('conversation_not_confirmed');
 const peers=[...new Set([...main.querySelectorAll('a[href]')].filter(visible).map(a=>(a.getAttribute('href')||'').match(/^\/([a-zA-Z0-9._]{1,30})\/$/)?.[1]?.toLowerCase()).filter(v=>v&&v!==scope.owner&&!['direct','explore','reels','accounts','p'].includes(v)))];
 if(peers.length!==1)throw Error('peer_not_unique');const account=peers[0];
 const articles=[...main.querySelectorAll('[role="article"]')].filter(visible);if(articles.length>50)throw Error('visible_scope_too_large');
 const labels=[...main.querySelectorAll('span')].filter(e=>visible(e)&&!e.closest('[role="article"]')&&e.children.length===0&&/^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}$/.test(e.textContent.trim()));
 const events=[];let seenOutbound=false;
 for(const article of articles){
  const parent=article.parentElement,row=parent?.parentElement;if(!row)continue;
  const a=article.getBoundingClientRect(),r=row.getBoundingClientRect(),pStyle=style(parent),rStyle=style(row);
  let direction='unknown';
  if(a.width<r.width*.85&&a.left>=r.left&&a.right<=r.right){
   if(pStyle.flexDirection==='row'&&rStyle.justifyContent==='flex-start'&&Math.abs(a.left-r.left)<=12)direction='inbound';
   if(pStyle.flexDirection==='row-reverse'&&rStyle.justifyContent==='flex-end'&&Math.abs(a.right-r.right)<=20)direction='outbound';
  }
  let date=null;
  if(scope.timeZone==='Asia/Tokyo'){
   const nearby=labels.filter(e=>{const t=e.getBoundingClientRect();return t.left>=r.left&&t.right<=r.right&&t.bottom<=a.top&&a.top-t.bottom<=50&&!articles.some(other=>{const o=other.getBoundingClientRect();return other!==article&&o.top>=t.bottom&&o.top<a.top;});});
   if(nearby.length===1){const m=nearby[0].textContent.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2})$/);const d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;if(+m[4]<24&&+m[5]<60&&day(d)&&d>=scope.rangeStart&&d<=scope.rangeEnd)date=d;}
  }
  const add=(type,evidence,reason)=>events.push({account,type,date,direction,historyStartSeen:false,firstOutboundConfirmed:false,evidence,verified:false,reason,party:''});
  if(direction==='inbound')add('reply','received_message',date?'':'date_unknown');
  if(direction==='outbound'&&!seenOutbound){add('new_dm','unknown','history_incomplete');seenOutbound=true;}
  // Never return message text; a Zoom mention is NOT proof of an invitation.
  if(direction!=='inbound'&&/\bzoom\b/i.test(article.textContent||''))add('zoom_invite','ambiguous_zoom',direction==='unknown'?'direction_unknown':'ambiguous_invitation');
 }
 return {version:1,owner:scope.owner,source:'browser_observation',capturedAt:scope.capturedAt,rangeStart:scope.rangeStart,rangeEnd:scope.rangeEnd,coverage:'partial',events};
}
