const labels={trialUsers:'試用人数',desiredQty:'希望数',proposedQty:'提案数',confirmedQty:'確定導入数'};
export function notesView(org,kind,esc){
 const notes=(org.meetingNotes||[]).filter(n=>n.kind===kind);
 return `<section class="notes-panel"><h3>議事録・根拠</h3><p role="status">Notta自動連携：未接続。自動参加・録音は行いません。</p><details><summary>議事録を保存</summary><p>参加者への録音告知と同意を確認した議事録のみ保存してください。Nottaへ新たな送信は行いません。</p><label>Notta出典URL<input id="note-source" type="url"></label><label>会議日時（日本時間）<input id="note-at" type="datetime-local" value="${esc(org[kind+'ZoomAt']||'')}"></label><label>要約<textarea id="note-summary" maxlength="5000"></textarea></label><label>Nottaから書き出した本文（UTF-8 TXT・最大60KB）<input id="note-file" type="file" accept=".txt,text/plain"></label><p id="note-file-status" role="status">ファイルはこの画面で読み込み、保存ボタンを押すまで送信しません。本文が入力済みの場合は先に内容を保全してください。</p><label>議事録本文<textarea id="note-body" maxlength="20000"></textarea></label><label><input id="note-consent" type="checkbox">参加者への告知・同意と、このアプリへの保存権限を確認済み</label><p>数値は候補として保存します。希望・提案・確定導入を分け、根拠を確認して反映するまで項目の値は変わりません。</p><button type="button" id="note-import">保存して数値を抽出</button></details>
 ${notes.map(n=>`<details><summary>${esc(n.meetingAt)} の議事録</summary><p>${esc(n.summary||'要約未入力')}</p><p>出典：${esc(n.source)}</p><pre class="note-body">${esc(n.body)}</pre>${n.facts.map((f,i)=>`<article><b>${labels[f.field]}：${f.status==='pending'?'確認待ち':f.status==='undone'?'取消済み':f.value??'確認値'}</b><blockquote>${esc(f.quote)}</blockquote><small>根拠 ${f.line}行目</small>${f.status==='applied'?`<button type="button" data-note-undo="${esc(n.id)}:${i}">反映を元に戻す</button>`:f.status==='pending'?`<label>確認した数値<input type="number" min="0" max="99999999" id="fact-${esc(n.id)}-${i}" value="${f.value??''}"></label><button type="button" data-note-approve="${esc(n.id)}:${i}">根拠を確認して反映</button>`:''}</article>`).join('')}<details><summary>更新履歴</summary>${n.history.map(h=>`<p>${esc(h.at)} ${labels[h.field]}：${h.before??'未入力'} → ${h.after??'未入力'} (${esc(h.action)})</p>`).join('')}</details></details>`).join('')}</section>`;
}

// Read an explicitly selected text export only; never fetch a source URL or audio.
export async function readNottaText(file){
 if(!file || !/\.txt$/i.test(file.name) || file.size>60000)throw Error('60KB以下のUTF-8 TXTファイルを選択してください');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 if(!text.trim() || text.length>20000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw Error('本文は空でない20,000文字以内のテキストにしてください');
 return text;
}
export function bindNottaText(root){
 const picker=root.querySelector('#note-file'),body=root.querySelector('#note-body'),status=root.querySelector('#note-file-status');
 picker.onchange=async()=>{
  const file=picker.files?.[0];if(!file)return;
  if(body.value){status.textContent='入力済みの本文を保全しました。別の議事録を読み込む場合は、先に本文を保存または退避してください。';picker.value='';return;}
  picker.disabled=true;
  try{const text=await readNottaText(file);if(body.value)throw Error('読み込み中に入力された本文を保全しました');body.value=text;status.textContent='本文を読み込みました（未保存）。出典URL・会議日時・要約と同意を確認して保存してください。';}
  catch{status.textContent='読み込めませんでした。入力済みの本文は保持しました。UTF-8 TXT・60KB以下・20,000文字以内を確認してください。';}
  finally{picker.disabled=false;picker.value='';}
 };
}
