import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOrgKPI, renderOrgList, renderOrgKPI, newOrg } from '../public/org-sales.js';

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

test('overdue next-action is not flagged for lost/repeat-purchase orgs', () => {
  const lost = org({ stage: '失注', nextAction: 'フォロー', nextDue: '2026-10-01' });
  const html = renderOrgList([lost], { stage: 'all', assignee: 'all' }, esc, '2026-10-21');
  assert.doesNotMatch(html, /期限超過/);
});

test('newOrg starts with the first pipeline stage and empty history', () => {
  const o = newOrg();
  assert.equal(o.stage, 'DM送信');
  assert.deepEqual(o.history, []);
});

test('cohort table renders a conversion rate with explicit denominator', () => {
  const o = org({ history: [{ stage: 'DM送信', at: '2026-10-01T00:00:00.000Z', note: '' }, { stage: '有償導入', at: '2026-10-05T00:00:00.000Z', note: '' }] });
  const html = renderOrgKPI([o], { start: '', end: '' }, esc);
  assert.match(html, /2026-10/);
  assert.match(html, /対象期間/);
});
