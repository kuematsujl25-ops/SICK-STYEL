import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate, STAFF_ASSIGNEES, STAFF_TASK_STATUS } from '../lib/domain.js';
import { renderStaffTasks } from '../public/staff-tasks.js';

const base = () => ({ id: 's1', title: 'サンプル採寸の依頼', assignee: '入戸野', due: '2026-10-20', priority: '中', status: '未着手', relatedOrg: '', relatedPlayer: '', relatedPost: '', nextAction: '返信を待つ', notes: '', updatedAt: '2026-10-20T00:00:00.000Z' });
const withTask = (overrides) => { const d = empty(); d.brand.Mission = 'm'; d.staffTasks.push({ ...base(), ...overrides }); return d; };

test('valid staff task round-trips through validate', () => {
 const d = withTask({});
 const v = validate(d);
 assert.equal(v.staffTasks.length, 1);
 assert.equal(v.staffTasks[0].assignee, '入戸野');
});

test('担当未設定（空文字）は許可される', () => {
 assert.doesNotThrow(() => validate(withTask({ assignee: '' })));
});

test('許可されていない担当者名は拒否される', () => {
 assert.throws(() => validate(withTask({ assignee: '未知の担当者' })));
});

test('期限は必須で、不正な日付は拒否される', () => {
 assert.throws(() => validate(withTask({ due: '' })));
 assert.throws(() => validate(withTask({ due: '2026-02-31' })));
});

test('状態は4種類以外拒否される', () => {
 assert.throws(() => validate(withTask({ status: '対応中' })));
 for (const s of STAFF_TASK_STATUS) assert.doesNotThrow(() => validate(withTask({ status: s })));
});

test('updatedAtは厳密なISO形式のみ許可', () => {
 assert.throws(() => validate(withTask({ updatedAt: '2026-10-20' })));
 assert.throws(() => validate(withTask({ updatedAt: 'not-a-date' })));
});

test('関連先・次の行動は500文字を超えると拒否される', () => {
 assert.throws(() => validate(withTask({ relatedOrg: 'x'.repeat(501) })));
 assert.throws(() => validate(withTask({ nextAction: 'x'.repeat(501) })));
});

test('STAFF_ASSIGNEES is the fixed three-person roster', () => {
 assert.deepEqual(STAFF_ASSIGNEES, ['入戸野', '竹田', '植松']);
});

const esc = String;
const sample = (over = {}) => ({ id: 'x', title: 't', assignee: '竹田', due: '2026-10-20', priority: '中', status: '未着手', relatedOrg: '', relatedPlayer: '', relatedPost: '', nextAction: '', notes: '', updatedAt: '2026-10-19T00:00:00.000Z', ...over });

test('overdue/due-today/unassigned counts are computed from open tasks only', () => {
 const tasks = [sample({ id: 'a', due: '2026-10-19' }), sample({ id: 'b', due: '2026-10-20' }), sample({ id: 'c', assignee: '', due: '2026-10-25' }), sample({ id: 'd', due: '2026-10-01', status: '完了' })];
 const html = renderStaffTasks(tasks, { assignee: 'all', sort: 'due' }, esc, '2026-10-20');
 assert.match(html, />1<em> 件/); // overdue: only 'a' (before today, not done)
 assert.match(html, /担当未設定<\/small><strong>1<em> 件/);
});

test('assignee filter narrows the visible list', () => {
 const tasks = [sample({ id: 'a', assignee: '入戸野' }), sample({ id: 'b', assignee: '竹田' })];
 const all = renderStaffTasks(tasks, { assignee: 'all', sort: 'due' }, esc, '2026-10-20');
 const narrowed = renderStaffTasks(tasks, { assignee: '入戸野', sort: 'due' }, esc, '2026-10-20');
 assert.match(all, /2 \/ 2 件/);
 assert.match(narrowed, /1 \/ 2 件/);
});

test('unassigned tab shows only tasks without an assignee', () => {
 const tasks = [sample({ id: 'a', assignee: '' }), sample({ id: 'b', assignee: '竹田' })];
 const html = renderStaffTasks(tasks, { assignee: 'unassigned', sort: 'due' }, esc, '2026-10-20');
 assert.match(html, /1 \/ 2 件/);
});

test('overdue rows are flagged for styling, completed overdue rows are not', () => {
 const tasks = [sample({ id: 'a', due: '2026-10-01' }), sample({ id: 'b', due: '2026-10-01', status: '完了' })];
 const html = renderStaffTasks(tasks, { assignee: 'all', sort: 'due' }, esc, '2026-10-20');
 const redCount = (html.match(/class="red"/g) || []).length;
 assert.equal(redCount, 1);
});

test('deletedAtが設定された（論理削除済みの）タスクは一覧・集計から除外される', () => {
 const tasks = [sample({ id: 'a', deletedAt: '2026-10-19T00:00:00.000Z' }), sample({ id: 'b' })];
 const html = renderStaffTasks(tasks, { assignee: 'all', sort: 'due' }, esc, '2026-10-20');
 assert.match(html, /1 \/ 1 件/);
});

test('論理削除済みタスクはゴミ箱セクションに表示され、復元ボタンを持つ', () => {
 const tasks = [sample({ id: 'a', deletedAt: '2026-10-19T12:00:00.000Z' })];
 const html = renderStaffTasks(tasks, { assignee: 'all', sort: 'due' }, esc, '2026-10-20');
 assert.match(html, /ゴミ箱（1件/);
 assert.match(html, /data-restore-stafftask="a"/);
});

test('deletedAtはnull・未設定・ISO文字列のいずれも検証を通過する', () => {
 assert.doesNotThrow(() => validate(withTask({})));
 assert.doesNotThrow(() => validate(withTask({ deletedAt: null })));
 assert.doesNotThrow(() => validate(withTask({ deletedAt: '2026-10-20T00:00:00.000Z' })));
 assert.throws(() => validate(withTask({ deletedAt: 'not-a-date' })));
});
