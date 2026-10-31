import sample from './sample.js';
import {previewBatch,stagePreview,summarize,TYPES} from './model.js';
const $=id=>document.getElementById(id);
let preview=null,ledger=[];
function invalidate(){preview=null;$('stage').disabled=true;$('confirm').checked=false;$('scope').textContent='入力変更後は再検査してください';$('rows').replaceChildren();}
for(const id of ['input','owner'])$(id).addEventListener('input',invalidate);
$('confirm').onchange=()=>{$('stage').disabled=!preview||!$('confirm').checked;};
function show(){const s=summarize(ledger,$('month').value);$('result').textContent=Object.entries(s.monthly).map(([t,n])=>`${TYPES[t]}：確認済み ${n}アカウント`).join(' ／ ')+'（部分確認）';$('cohort').textContent=`初回DM月コホート：${s.cohort.size}先 → 観測済み期間の返信 ${s.cohort.reply}先 ／ Zoom案内 ${s.cohort.zoom_invite}先。月内活動とは別集計。`;}
function safely(fn){try{$('error').textContent='';fn();}catch{$('error').textContent='取込を停止しました。形式・対象アカウント・初回DM日の競合・営業先対応を確認してください。';}}
$('month').onchange=()=>safely(show);
$('sample').onclick=()=>{$('owner').value=sample.owner;$('month').value=sample.rangeStart.slice(0,7);$('input').value=JSON.stringify(sample,null,2);$('error').textContent='';invalidate();};
$('preview').onclick=()=>{invalidate();safely(()=>{
 if($('input').value.length>200000)throw Error('size');
 preview=previewBatch(JSON.parse($('input').value),$('owner').value);
 const b=preview.batch;$('scope').textContent=`対象 @${b.owner} / ${b.rangeStart}〜${b.rangeEnd} JST / 取得 ${b.capturedAt} / ${b.source} / 部分確認 ${b.events.length}候補`;
 const table=document.createElement('table');
 for(const values of [['相手','活動','日付','営業先ID','検証状態'],...preview.rows.map(e=>[e.account,TYPES[e.type],e.date||'不明',e.party||'未対応',e.reasons.join(' / ')||'計上候補（本人確認待ち）'])]){
 const tr=table.insertRow();for(const v of values)tr.insertCell().textContent=v;
 }$('rows').append(table);
 });};
$('stage').onclick=()=>safely(()=>{if(!preview||!$('confirm').checked)throw Error('confirm');ledger=stagePreview(ledger,preview);show();$('confirm').checked=false;$('stage').disabled=true;});

// Do not retain candidate text in the back/forward cache. No storage or network writes.
addEventListener('pagehide',()=>{ledger=[];preview=null;$('input').value='';$('rows').replaceChildren();$('result').textContent='一時データを消去しました';$('cohort').textContent='';$('scope').textContent='未読込';$('owner').value='';$('confirm').checked=false;$('stage').disabled=true;});
