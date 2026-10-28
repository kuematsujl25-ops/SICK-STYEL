import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readNottaText,bindNottaText,notesView} from '../public/meeting-notes-ui.js';
const file=(body,name='example.txt')=>new File([body],name,{type:'text/plain'});
test('Notta text export is decoded without network and rejects unsupported or excessive content',async()=>{
 assert.equal(await readNottaText(file('\uFEFF試用人数は12人で確定です。\r\n希望数は50個で確定です。')),'試用人数は12人で確定です。\n希望数は50個で確定です。');
 for(const f of [file('data','a.mp3'),file(' '),file('a'.repeat(20001)),file('あ'.repeat(20001)),file('\0binary'),file(new Uint8Array([0xff]))])await assert.rejects(readNottaText(f));
});
test('text selection preserves drafts including input typed during the async read; never checks consent',async()=>{
 const summary={value:'kept summary'},summaryPicker={files:[file('new summary')],disabled:false,value:'selected'},summaryStatus={textContent:''};
 const body={value:''},picker={files:[file('Example transcript')],disabled:false,value:'selected'},status={textContent:''};
 bindNottaText({querySelector:s=>({'#note-body':body,'#note-file':picker,'#note-file-status':status,'#note-summary':summary,'#note-summary-file':summaryPicker,'#note-summary-file-status':summaryStatus})[s]});
 await picker.onchange();assert.equal(body.value,'Example transcript');assert.match(status.textContent,/未保存/);
 await summaryPicker.onchange();assert.equal(summary.value,'kept summary');summary.value='';await summaryPicker.onchange();assert.equal(summary.value,'new summary');assert.equal(body.value,'Example transcript');
 await assert.rejects(readNottaText(file('a'.repeat(5001)),5000));
 picker.files=[file('replacement')];await picker.onchange();assert.equal(body.value,'Example transcript');
 body.value='';picker.files=[{name:'example.txt',size:5,arrayBuffer:async()=>{body.value='typed during read';return new TextEncoder().encode('file').buffer;}}];await picker.onchange();assert.equal(body.value,'typed during read');assert.equal(picker.disabled,false);
 assert.match(notesView({},'initial',String),/議事録自動取得：未接続/);assert.doesNotMatch(notesView({},'initial',String),/type="checkbox" checked/);
});
