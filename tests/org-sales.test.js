import {renderMeetingEditor} from '../public/meetings.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOrgKPI, renderOrgList, renderOrgKPI, renderOrgEditor, newOrg } from '../public/org-sales.js';

const esc = String;
const org = (over = {}) => ({ id: 'o1', name: 'テストFC', category: 'サッカー', size: '', assignee: '竹田', contact: '',
  stage: 'DM送信', sampleQty: null, sampleCost: null, shippingCost: null, trialUsers: null, feedback: '', proposal: '',
  paidQty: null, paidRevenue: null, paidCost: null, lostReason: '', nextAction: '', nextDue: '', notes: '', updatedAt: '2026-10-10T00:00:00.000Z',
  history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }], deletedAt: null, ...over });

test('DM送信 count counts events, dmUniqueOrgs counts distinct orgs', () => {
  const a = org({ id: 'a' });
  const b = org({ id: 'b', history: [{ stage: 'DM送信', at: '2026-10-02T00:00:00.000Z', note: '' }, { stage: 'DM送信', at: '2026-10-05T00:00:00.000Z', note: 're-send' }] });
  const k = computeOrgKPI([a, b], '', '');
  assert.equal(k.dmCount, 3); // a:1 + b:2
  assert.equal(k.dmUniqueOrgs, 2);
});

test('sample sent to paid conversion counts stage transitions, not final state alone', () => {
  const won = org({ id: 'w', stage: '有償導入', paidQty: 5, paidRevenue: 10000,
    history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: 'サンプル発送', at: '2026-10-02T00:00:00.000Z', note: '' }, { stage: '有償導入', at: '2026-10-10T00:00:00.000Z', note: '' }] });
  const lost = org({ id: 'l', stage: '失注', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: 'サンプル発送', at: '2026-10-02T00:00:00.000Z', note: '' }, { stage: '失注', at: '2026-10-05T00:00:00.000Z', note: '在庫過多' }] });
  const k = computeOrgKPI([won, lost], '', '');
  assert.equal(k.paidOrgs, 1);
  assert.equal(k.paidQty, 5);
  assert.equal(k.firstPurchase, 10000);
});

test('period filter narrows by event date, not record update time', () => {
  const o = org({ history: [{ stage: 'DM送信', at: '2026-09-01T00:00:00.000Z', note: '' }] });
  const inPeriod = computeOrgKPI([o], '2026-10-01', '2026-10-31');
  assert.equal(inPeriod.dmCount, 0); // 9月のイベントは10月の集計に含めない
  const sept = computeOrgKPI([o], '2026-09-01', '2026-09-30');
  assert.equal(sept.dmCount, 1);
});

test('period filter converts history timestamps to JST before comparing dates, so an early-morning JST event is not misattributed to the previous UTC day (Codex独立レビュー指摘の回帰)', () => {
  // 2026-10-23 08:00 JST = 2026-10-22 23:00 UTC として保存されている。
  const o = org({ history: [{ stage: 'DM送信', at: '2026-10-22T23:00:00.000Z', note: '' }] });
  const onThatJstDay = computeOrgKPI([o], '2026-10-23', '2026-10-23');
  assert.equal(onThatJstDay.dmCount, 1, '日本時間の10/23に発生したイベントは、10/23を対象期間とした集計に含まれる');
  const onPriorUtcDay = computeOrgKPI([o], '2026-10-22', '2026-10-22');
  assert.equal(onPriorUtcDay.dmCount, 0, 'UTC上の日付(10/22)ではなく、日本時間の日付で判定される');
});

test('sample-only orgs (no 有償導入) are not counted as revenue', () => {
  const sampleOnly = org({ history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: 'サンプル発送', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const k = computeOrgKPI([sampleOnly], '', '');
  assert.equal(k.paidOrgs, 0);
  assert.equal(k.firstPurchase, 0);
});

test('deleted orgs are excluded from list and KPI', () => {
  const deleted = org({ id: 'd', deletedAt: '2026-10-11T00:00:00.000Z' });
  const html = renderOrgList([deleted], { stage: 'all', assignee: 'all' }, esc, '2026-10-21');
  assert.match(html, /団体はまだ登録されていません/);
  const k = computeOrgKPI([deleted], '', '');
  assert.equal(k.dmUniqueOrgs, 0);
});

test('stage filter narrows the list', () => {
  const dm = org({ id: 'a', stage: 'DM送信' });
  const paid = org({ id: 'b', stage: '有償導入' });
  const html = renderOrgList([dm, paid], { stage: '有償導入', assignee: 'all' }, esc, '2026-10-21');
  assert.match(html, /1 \/ 2 件/);
});

test('検索語（ui.q）はレンダリング自体で絞り込みに反映される（Codex独立レビュー指摘の回帰：以前は入力時のDOM直接操作だけで絞り込んでおり、段階・担当切替等での再描画で検索結果が失われていた）', () => {
  const a = org({ id: 'a', name: 'FC渋谷' });
  const b = org({ id: 'b', name: 'FC横浜' });
  const all = renderOrgList([a, b], { stage: 'all', assignee: 'all', q: '' }, esc, '2026-10-21');
  const searched = renderOrgList([a, b], { stage: 'all', assignee: 'all', q: '渋谷' }, esc, '2026-10-21');
  assert.match(all, /2 \/ 2 件/);
  assert.match(searched, /1 \/ 2 件/, '検索語に一致する1件だけに絞り込まれる');
  assert.match(searched, /FC渋谷/);
  assert.doesNotMatch(searched, /FC横浜/);
  assert.match(searched, /value="渋谷"/);
});

test('overdue next-action is not flagged for lost/repeat-purchase orgs', () => {
  const lost = org({ stage: '失注', nextAction: 'フォロー', nextDue: '2026-10-01' });
  const html = renderOrgList([lost], { stage: 'all', assignee: 'all' }, esc, '2026-10-21');
  assert.doesNotMatch(html, /期限超過/);
});

test('停滞案件は14日以上動きがない進行中の団体だけに表示され、失注・継続購入・連絡不要は対象外', () => {
  const stalled = org({ id: 's', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }] });
  const fresh = org({ id: 'f', history: [{ stage: 'DM送信', at: '2026-10-15T00:00:00.000Z', note: '' }] });
  const lostButOld = org({ id: 'l', stage: '失注', history: [{ stage: '失注', at: '2026-09-01T00:00:00.000Z', note: '' }] });
  const html = renderOrgList([stalled, fresh, lostButOld], { stage: 'all', assignee: 'all' }, esc, '2026-10-21');
  assert.match(html, /停滞案件（14日以上動きなし）<\/small><strong>1/);
  assert.match(html, />停滞</);
});

test('newOrg starts with the first pipeline stage and empty history', () => {
  const o = newOrg();
  assert.equal(o.stage, 'DM送信');
  assert.deepEqual(o.history, []);
});

test('MTG自動作成ボタンは、Zoom・Googleカレンダーとも接続済みで、かつ団体が保存済みの場合のみ表示される', () => {
  const saved = org({ id: 'o1', initialZoomAt: '2026-10-28T14:00' });
  const unconnected = renderMeetingEditor(saved, 'initial', esc, { zoomConnected: false, calendarConnected: true });
  assert.doesNotMatch(unconnected, /data-mtgsync="initial:prepare"/);
  const unsaved = renderOrgEditor(null, esc, '2026-10-21', { zoomConnected: true, calendarConnected: true });
  assert.doesNotMatch(unsaved, /data-mtgsync="initial:prepare"/);
  const ready = renderMeetingEditor(saved, 'initial', esc, { zoomConnected: true, calendarConnected: true });
  assert.match(ready, /data-mtgsync="initial:prepare"/);
  assert.match(ready, /確認してZoomを作成/);
});

test('同期済みMTGは「日程を同期し直す」「MTGを取消」を表示し、未作成時は作成ボタンのみ', () => {
  const synced = org({ id: 'o1', initialZoomAt: '2026-10-28T14:00', initialMeetingSync: { requestId: 'r1', zoomMeetingId: 'z1', calendarEventId: 'e1', status: 'synced', error: null, updatedAt: '2026-10-21T00:00:00.000Z' } });
  const html = renderMeetingEditor(synced, 'initial', esc, { zoomConnected: true, calendarConnected: true });
  assert.match(html, /data-mtgsync="initial:update"/);
  assert.match(html, /data-mtgsync="initial:cancel"/);
  assert.doesNotMatch(html, /data-mtgsync="initial:create"/);
});

test('zoom_only（Zoom作成済み・カレンダー未登録）の会議は「再試行する」で同期を再開でき、取消しか選べない状態にならない（Codex独立レビュー指摘の回帰）', () => {
  const zoomOnly = org({ id: 'o1', initialZoomAt: '2026-10-28T14:00', initialMeetingSync: { requestId: 'r1', zoomMeetingId: 'z1', calendarEventId: null, status: 'zoom_only', error: null, updatedAt: '2026-10-21T00:00:00.000Z' } });
  const html = renderMeetingEditor(zoomOnly, 'initial', esc, { zoomConnected: true, calendarConnected: true });
  assert.match(html, /data-mtgsync="initial:create"/, 'zoom_onlyでも再試行（カレンダー登録の再開）ボタンが表示される');
  assert.match(html, /data-mtgsync="initial:cancel"/);
});

test('uncertain（Zoom会議が実際に作成されたか不明）の会議は、無言の重複作成を防ぐため通常の「再試行する」ボタンを出さず、取消（ローカルの記録クリア）だけを提示する（Codex独立レビュー指摘の回帰）', () => {
  const uncertain = org({ id: 'o1', initialZoomAt: '2026-10-28T14:00', initialMeetingSync: { requestId: 'r1', zoomMeetingId: null, calendarEventId: null, status: 'uncertain', error: 'Zoomへの通信がタイムアウトし、会議が実際に作成されたか不明です。', updatedAt: '2026-10-21T00:00:00.000Z' } });
  const html = renderMeetingEditor(uncertain, 'initial', esc, { zoomConnected: true, calendarConnected: true });
  assert.doesNotMatch(html, /data-mtgsync="initial:create"/, 'uncertainでは確認前の自動的な再試行を促さない（重複作成の回避）');
  assert.match(html, /data-mtgsync="initial:cancel"/, '確認後にローカルの記録をクリアする手段は残す');
  assert.match(html, /結果不明・管理者の確認が必要/);
  assert.match(html, /会議が実際に作成されたか不明です/);
});

test('cohort month uses JST, not UTC, for grouping the first history entry (Codex独立レビュー指摘の回帰)', () => {
  // 2026-11-01 08:00 JST = 2026-10-31 23:00 UTC。UTCのまま月を切り出すと「2026-10」に誤分類される。
  const o = org({ history: [{ stage: 'DM送信', at: '2026-10-31T23:00:00.000Z', note: '' }] });
  const html = renderOrgKPI([o], { start: '', end: '' }, esc);
  assert.match(html, /2026-11/, '日本時間の開始月（2026-11）でコホートに分類される');
  assert.doesNotMatch(html, /<td>2026-10<\/td>/, 'UTCの日付(2026-10)では分類されない');
});

test('返信あり団体は「返信待ち」「保留」「失注」「連絡不要」への移動だけでは数えない（実際に前進した段階だけを返信とみなす、Codex独立レビュー指摘の回帰）', () => {
  const waitingOnly = org({ id: 'w', stage: '返信待ち', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '返信待ち', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const onHold = org({ id: 'h', stage: '保留', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '保留', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const lostNoReply = org({ id: 'l', stage: '失注', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '失注', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const noContact = org({ id: 'n', stage: '連絡不要', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '連絡不要', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const actuallyReplied = org({ id: 'r', stage: '初回ZOOM予約', history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '初回ZOOM予約', at: '2026-10-02T00:00:00.000Z', note: '' }] });
  const k = computeOrgKPI([waitingOnly, onHold, lostNoReply, noContact, actuallyReplied], '', '');
  assert.equal(k.repliedOrgs, 1, '実際に前進（初回ZOOM予約以降）した団体だけが返信ありとして数えられる');
});

test('cohort table renders a conversion rate with explicit denominator', () => {
  const o = org({ history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '有償導入', at: '2026-10-05T00:00:00.000Z', note: '' }] });
  const html = renderOrgKPI([o], { start: '', end: '' }, esc);
  assert.match(html, /2026-10/);
  assert.match(html, /対象期間/);
});

test('切断後も既存会議の状態・取消再試行を表示し、新規作成/更新を許さない',()=>{
 for(const zoomConnected of [false,true])for(const calendarConnected of [false,true]){
  if(zoomConnected&&calendarConnected)continue;
  for(const kind of ['initial','proposal'])for(const status of ['synced','error','zoom_only','uncertain']){
   const saved=org({id:'o1',[kind+'MeetingSync']:{requestId:'qa',zoomMeetingId:'qa-z',calendarEventId:null,status,cancelPending:true,error:'架空の取消失敗'}});
   const html=renderMeetingEditor(saved,kind,esc,{zoomConnected,calendarConnected});
   assert.match(html,new RegExp('data-mtgsync="'+kind+':cancel"'));
   assert.match(html,/取消を再試行/);assert.match(html,/架空の取消失敗/);
   assert.doesNotMatch(html,new RegExp('data-mtgsync="'+kind+':(?:create|update)"'));
  }
 }
});
