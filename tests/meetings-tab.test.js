import {test} from 'node:test';import assert from 'node:assert/strict';
import {newOrg,renderOrgEditor} from '../public/org-sales.js';
import {renderMeetings,renderMeetingEditor,saveMeetingFields,meetingFormChanged} from '../public/meetings.js';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const org={...newOrg(),id:'example',name:'Example Club',history:[],proposalZoomAt:'2026-12-01T10:00',proposalZoomUrl:'https://example.com/legacy',proposalMeetingSync:{status:'zoom_only',zoomMeetingId:'old'}};
test('独立会議一覧は団体選択・既存会議・削除済み団体の復旧を表示する',()=>{
 const html=renderMeetings([org,{...org,id:'deleted',deletedAt:'2026-10-23T00:00:00Z'}],esc);
 assert.match(html,/name="orgId"/);assert.match(html,/name="kind"/);assert.match(html,/<option value="proposal">2件目/);assert.match(html,/data-meetingkind="proposal"/);assert.match(html,/data-restoreorg="deleted"/);assert.doesNotMatch(html,/<details open/);
 const editor=renderOrgEditor(org,esc,'2026-10-23');assert.doesNotMatch(editor,/name="(?:initial|proposal)(?:Zoom|Meeting)/);
});
test('会議エディタはURLを常に読み取り専用とし未認可・結果不明を隠さない',()=>{
 const html=renderMeetingEditor(org,'initial',esc,{zoomConnected:true,calendarConnected:true,calendarIdentityReady:false});
 assert.match(html,/追加承認・Google再認可が未完了/);assert.doesNotMatch(html,/data-mtgsync="initial:prepare"/);assert.match(html,/readonly/);assert.doesNotMatch(html,/name="initialZoomUrl"/);
 const uncertain=renderMeetingEditor({...org,initialMeetingSync:{status:'uncertain',error:'結果を確認してください'}},'initial',esc,{zoomConnected:true,calendarConnected:true,calendarIdentityReady:true});
 assert.match(uncertain,/role="alert"/);assert.match(uncertain,/data-mtgsync="initial:cancel"/);assert.doesNotMatch(uncertain,/data-mtgsync="initial:(prepare|create)"/);
});
test('会議保存は選択した内容・日時・所要時間だけ更新し既存URL・同期ID・旧会議を維持する',()=>{
 const values={initialMeetingContent:'説明',initialZoomAt:'2026-12-02T12:00',initialMeetingDurationMin:'60',initialZoomUrl:'https://attacker.example'};
 const next=saveMeetingFields(org,'initial',values);
 assert.equal(next.initialMeetingDurationMin,60);assert.equal(next.initialZoomUrl,org.initialZoomUrl);
 for(const key of ['proposalZoomAt','proposalZoomUrl','proposalMeetingSync','history'])assert.deepEqual(next[key],org[key]);
 assert.equal(meetingFormChanged(next,'initial',values),false);
 assert.equal(meetingFormChanged(next,'initial',{...values,initialMeetingDurationMin:'90'}),true);
 assert.throws(()=>saveMeetingFields(org,'initial',{...values,initialMeetingDurationMin:'0'}),/所要時間/);
});

test('新しい団体でも会議タブの2件目選択で専用欄なしに会議を準備できる',()=>{
 const fresh={...newOrg(),id:'fresh',name:'New Club'};
 const html=renderMeetings([fresh],esc);assert.match(html,/<option value="proposal">2件目/);
 const next=saveMeetingFields(fresh,'proposal',{proposalMeetingContent:'相談',proposalZoomAt:'2026-12-03T10:00',proposalMeetingDurationMin:'30'});
 assert.equal(next.initialZoomAt,fresh.initialZoomAt);assert.equal(next.proposalMeetingDurationMin,30);
 const editor=renderMeetingEditor(next,'proposal',esc,{zoomConnected:true,calendarConnected:true,calendarIdentityReady:true});
 assert.match(editor,/data-mtgsync="proposal:prepare"/);
});
