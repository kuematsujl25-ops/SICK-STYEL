import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCollectionTasks, allStandardItems, CATEGORIES } from '../public/collection-tasks.js';

const esc = String;

test('allStandardItems covers all four categories with purpose and source filled in', () => {
  const items = allStandardItems();
  assert.ok(items.length >= 25);
  for (const cat of CATEGORIES) assert.ok(items.some(i => i.category === cat));
  for (const i of items) { assert.ok(i.title); assert.ok(i.purpose); assert.ok(i.source); }
});

test('standard items have no duplicate (category,title) pairs', () => {
  const items = allStandardItems();
  const seen = new Set();
  for (const i of items) { const key = i.category + '|' + i.title; assert.ok(!seen.has(key), key); seen.add(key); }
});

const item = (over = {}) => ({ id: 'c1', title: 'SKU別販売個数', category: '商品・利益', purpose: '売れ筋判断', source: '注文データ',
  frequency: '月次', assignee: '入戸野', due: '', period: '', status: '未収集', value: '', notes: '', ...over });

test('status counts are computed per category-agnostic status', () => {
  const html = renderCollectionTasks([item({ status: '未収集' }), item({ id: 'c2', status: '収集済み' })], { category: 'all', status: 'all' }, esc);
  assert.match(html, /未収集<\/small><strong>1/);
  assert.match(html, /収集済み<\/small><strong>1/);
});

test('category filter narrows the list', () => {
  const html = renderCollectionTasks([item({ category: '商品・利益' }), item({ id: 'c2', category: 'SNS' })], { category: 'SNS', status: 'all' }, esc);
  assert.match(html, /1 \/ 2 件/);
});

test('未取得の値は0として表示しない（valueが空なら値の表示を出さない）', () => {
  const html = renderCollectionTasks([item({ value: '' })], { category: 'all', status: 'all' }, esc);
  assert.doesNotMatch(html, /値: 0/);
});

test('deleted items are excluded', () => {
  const html = renderCollectionTasks([item({ deletedAt: '2026-10-21T00:00:00.000Z' })], { category: 'all', status: 'all' }, esc);
  assert.match(html, /まだ項目がありません/);
});
