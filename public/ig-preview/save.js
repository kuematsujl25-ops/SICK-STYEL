import {persistenceBatches} from './model.js';
// Explicit, same-origin persistence of confirmed metadata only. No browser/Instagram access.
const $=id=>document.getElementById(id);
let staged=[],status=null,sampleMode=false,busy=false;
const names={new_dm:'新規DM',reply:'返信',zoom_invite:'Zoom案内'};
async function api(path,data){
 const r=await fetch('/api/instagram-sales/'+path,{method:data?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});
 const result=await r.json();if(!r.ok)throw Error(result.error||'request_failed');return result;
}
function enabled(){ $('save').disabled=busy||sampleMode||!staged.length||!status?.configured||!$('save-confirm').checked; }
function note(text){$('save-status').textContent=text;}
async function safely(fn){if(busy)return;busy=true;enabled();try{await fn();}catch(e){note('保存処理を停止しました：'+e.message);}finally{busy=false;enabled();}}
function describe(counts){return Object.entries(names).map(([key,label])=>`${label} ${counts[key]}先`).join(' ／ ');}
async function refresh(){
 status=await api('status');$('saved-owner').textContent=status.configured?'保存対象 @'+status.owner:'保存対象は未設定です。';
 if(!status.configured){$('saved-kpi').textContent='未取得';enabled();return;}
 const [kpi,ledger]=await Promise.all([api('kpi?month='+encodeURIComponent($('month').value)),api('events')]);
 $('saved-kpi').textContent='保存済み・部分確認：'+describe(kpi.imported.monthly)+'。初回DM月コホート：'+describe(kpi.imported.cohort)+'。'+(kpi.combined?'既存手入力との対応確認済み合算：'+describe(kpi.combined.monthly):'手入力との合算保留：'+kpi.linkageReason);
 $('saved-rows').replaceChildren();const voids=new Set(ledger.voids.map(v=>v.key));
 for(const e of ledger.events){
  const row=document.createElement('div'),label=document.createElement('p');label.textContent=`@${e.peer} / ${names[e.type]} / ${e.date} JST / ${e.source} / ${voids.has(e.key)?'取消済み':'確認済み'}`;row.append(label);
  if(!voids.has(e.key)){
   const reason=document.createElement('select');for(const [value,text] of Object.entries({incorrect_date:'日付誤り',incorrect_identity:'相手誤り',incorrect_direction:'方向誤り',not_invitation:'案内ではない',duplicate:'重複'})){const option=document.createElement('option');option.value=value;option.textContent=text;reason.append(option);}
   const cancel=document.createElement('button');cancel.textContent='この記録を取り消す';cancel.onclick=()=>safely(async()=>{if(!confirm('この記録を集計から除外します。根拠と取消履歴は保持します。'))return;await api('void',{owner:status.owner,key:e.key,revision:ledger.revision,reason:reason.value});await refresh();note('取消を記録しました。再取込でも復活しません。');});row.append(reason,cancel);
  }
  if(Object.hasOwn(ledger.mappings,e.peer)){const mapped=document.createElement('p');mapped.textContent='対応済み営業先ID：'+ledger.mappings[e.peer];row.append(mapped);}
  else {const party=document.createElement('input');party.placeholder='既存手入力の送信先ID';party.maxLength=100;const link=document.createElement('button');link.textContent='同じ相手と確認して対応付け';link.onclick=()=>safely(async()=>{if(!confirm('既存手入力と同一の相手であることを確認しましたか？'))return;await api('mapping',{owner:status.owner,peer:e.peer,party:party.value,confirmed:true,revision:ledger.revision});await refresh();note('対応付けを保存しました。');});row.append(party,link);}
  $('saved-rows').append(row);
 }
 enabled();
}
addEventListener('instagram-staged',e=>{staged=e.detail; $('save-confirm').checked=false;enabled();});
addEventListener('instagram-invalidated',()=>{staged=[];$('save-confirm').checked=false;enabled();});
$('sample').addEventListener('click',()=>{$('owner-confirm').checked=false;sampleMode=true;enabled();note('合成サンプルは編集後も保存できません。「試算を消去して実観測へ」で切り替えてください。');});
addEventListener('instagram-reset',()=>{sampleMode=false;staged=[];$('owner-confirm').checked=false;$('save-confirm').checked=false;enabled();note('試算を消去しました。新しい観測候補を入力してください。');});
$('owner').addEventListener('input',()=>{$('owner-confirm').checked=false;});
$('save-confirm').onchange=enabled;
$('configure-owner').onclick=()=>safely(async()=>{if(sampleMode||!$('owner-confirm').checked)throw Error('対象アカウントの確認が必要です');await api('owner',{owner:$('owner').value.replace(/^@/,'').toLowerCase(),confirmed:true});await refresh();note('保存対象を登録しました。');});
$('save').onclick=()=>safely(async()=>{
 if(sampleMode||!$('save-confirm').checked||!staged.length)throw Error('確認済み候補が必要です');
 if(staged.some(e=>e.owner!==status.owner))throw Error('保存対象が一致しません');
 // Each source/capture is retained; a retry of a partly completed submission is idempotent.

 let added=0,replayed=0,suppressed=0;
 for(const batch of persistenceBatches(staged)){
  const result=await api('import',batch);
  added+=result.added;replayed+=result.replayed;suppressed+=result.suppressed;
 }
 $('save-confirm').checked=false;await refresh();note(`保存 ${added}件 ／ 重複 ${replayed}件 ／ 取消済み ${suppressed}件。本文は送信していません。`);
});
$('refresh-saved').onclick=()=>safely(refresh);$('month').addEventListener('change',()=>safely(refresh));
addEventListener('pagehide',()=>{staged=[];status=null;$('saved-rows').replaceChildren();$('saved-kpi').textContent='';$('saved-owner').textContent='';$('save-confirm').checked=false;});
safely(refresh);
