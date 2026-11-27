import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate, migrate } from '../lib/domain.js';

// 旧データ（staffTasks/orgSales/collectionTasksが存在しない保存済み文書）の互換性。
test('migrate backfills missing new collections without touching existing data', () => {
  const old = { goals: [{ id: 'g1', title: 'x', type: 'monthly', month: '2026-10', current: 1, target: 2, unit: '円' }], tasks: [], shipments: [], metrics: [], brand: { 理念: '', 起源: '', Mission: 'm', Vision: '', Values: '' }, integrations: {} };
  const m = migrate(old);
  assert.deepEqual(m.staffTasks, []);
  assert.deepEqual(m.orgSales, []);
  assert.deepEqual(m.collectionTasks, []);
  assert.equal(m.goals.length, 1);
});

test('validate accepts a document entirely missing the new collections (pre-feature backup)', () => {
  const old = empty();
  delete old.staffTasks; delete old.orgSales; delete old.collectionTasks;
  old.brand.Mission = 'm';
  const v = validate(old);
  assert.deepEqual(v.staffTasks, []);
  assert.deepEqual(v.orgSales, []);
  assert.deepEqual(v.collectionTasks, []);
});

test('validate still rejects a genuinely malformed staffTasks array (not just missing)', () => {
  const d = empty(); d.brand.Mission = 'm'; d.staffTasks = 'not-an-array';
  assert.throws(() => validate(d));
});

// Codex独立レビュー指摘(P1): migrate()がempty()を無条件に下敷きにしていたため、null・{}・{revision:N}だけの
// 壊れた/不完全な入力までもが「新しい空のワークスペース」として validate() を通過してしまい、
// /api/data のPUTや /api/restore 経由で本番の業務データを無言で空に上書きできる状態になっていた。
// migrate() は新規コレクション(NEW_COLLECTIONS)の欠落キーだけを補い、元からある必須項目
// （goals/tasks/shipments/metrics/brand/integrations）は一切補完しないことを確認する。
test('migrate/validate never silently treat null, {} or a revision-only body as a valid empty workspace (would allow a malformed request to wipe production data)', () => {
  for (const malformed of [null, undefined, {}, { revision: 5 }, []]) {
    assert.throws(() => validate(malformed), /データの形式が正しくありません/, 'malformed input: ' + JSON.stringify(malformed));
  }
  // migrate()自体も、goals等の元の必須項目を黙って補完してはいけない（validate()が拒否できるように欠落のまま返す）。
  assert.equal(migrate(null).goals, undefined);
  assert.equal(migrate({}).brand, undefined);
  assert.equal(migrate({ revision: 5 }).tasks, undefined);
});

const orgBase = () => ({ id: 'o1', name: 'テストFC', category: 'サッカー', size: '20名', assignee: '竹田', contact: 'a@example.com',
  stage: 'DM送信', sampleQty: null, sampleCost: null, shippingCost: null, trialUsers: null, feedback: '', proposal: '',
  paidQty: null, paidRevenue: null, paidCost: null, lostReason: '', nextAction: '', nextDue: '', notes: '', updatedAt: '2026-10-21T00:00:00.000Z',
  history: [{ stage: 'DM送信', at: '2026-10-21T00:00:00.000Z', note: '' }] });
const withOrg = (over = {}) => { const d = empty(); d.brand.Mission = 'm'; d.orgSales.push({ ...orgBase(), ...over }); return d; };

test('valid org record round-trips', () => {
  const v = validate(withOrg());
  assert.equal(v.orgSales[0].stage, 'DM送信');
});

test('unknown stage is rejected', () => {
  assert.throws(() => validate(withOrg({ stage: '謎の段階' })));
});

test('empty org name is rejected', () => {
  assert.throws(() => validate(withOrg({ name: '' })));
});

test('history must only contain known stages and valid timestamps', () => {
  assert.throws(() => validate(withOrg({ history: [{ stage: '謎', at: '2026-10-21T00:00:00.000Z', note: '' }] })));
  assert.throws(() => validate(withOrg({ history: [{ stage: 'DM送信', at: 'bad-date', note: '' }] })));
});

test('sample/paid numeric fields accept null (not sent as false zero) but reject negative', () => {
  assert.doesNotThrow(() => validate(withOrg({ sampleQty: null, paidRevenue: null })));
  assert.throws(() => validate(withOrg({ sampleQty: -1 })));
});

test('deletedAt soft-delete marker is accepted and excluded by convention, not hard-removed', () => {
  const d = withOrg({ deletedAt: '2026-10-21T01:00:00.000Z' });
  const v = validate(d);
  assert.equal(v.orgSales.length, 1);
  assert.equal(v.orgSales[0].deletedAt, '2026-10-21T01:00:00.000Z');
});

const collectBase = () => ({ id: 'c1', title: 'SKU別販売個数', category: '商品・利益', purpose: '売れ筋判断', source: '注文データ',
  frequency: '月次', assignee: '入戸野', due: '', period: '2026年10月', status: '未収集', value: '', notes: '', updatedAt: '2026-10-21T00:00:00.000Z' });
const withCollect = (over = {}) => { const d = empty(); d.brand.Mission = 'm'; d.collectionTasks.push({ ...collectBase(), ...over }); return d; };

test('valid collection task round-trips, due is optional', () => {
  const v = validate(withCollect());
  assert.equal(v.collectionTasks[0].due, '');
});

test('unknown category/status rejected', () => {
  assert.throws(() => validate(withCollect({ category: '謎' })));
  assert.throws(() => validate(withCollect({ status: '進行中' })));
});
