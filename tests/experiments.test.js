import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate } from '../lib/domain.js';
import { renderExperiments } from '../public/experiments.js';

const esc = String;
const exp = (over = {}) => ({ id: 'e1', title: 'ドリブル解説→購入実験', hypothesis: '解説を見た人が選手に共感し購入する',
  relatedPosts: 'post1,post2', targetProduct: 'サッカーボール', cta: 'プロフィールのリンクから', trackingLink: 'https://x?utm_campaign=a',
  periodStart: '2026-10-01', periodEnd: '2026-10-15', metricsWatched: 'リンククリック・購入件数',
  measuredPurchases: 3, unmeasuredNote: '共有プロフィールリンク経由は流入不明のまま', result: '', nextAction: '',
  status: '仮説検証中', updatedAt: '2026-10-15T00:00:00.000Z', ...over });

test('valid experiment round-trips', () => {
  const d = empty(); d.brand.Mission = 'm'; d.growthExperiments.push(exp());
  assert.equal(validate(d).growthExperiments[0].status, '仮説検証中');
});

test('measuredPurchasesはnull（未計測）を許可する', () => {
  const d = empty(); d.brand.Mission = 'm'; d.growthExperiments.push(exp({ measuredPurchases: null }));
  assert.doesNotThrow(() => validate(d));
});

test('未知の状態は拒否される', () => {
  const d = empty(); d.brand.Mission = 'm'; d.growthExperiments.push(exp({ status: '完了' }));
  assert.throws(() => validate(d));
});

test('フォロワー数で割った購入率は一切表示しない', () => {
  const html = renderExperiments([exp()], { status: 'all' }, esc);
  assert.doesNotMatch(html, /フォロワー転換率|購入率/);
  assert.match(html, /計測できた購入<b>3件/);
});

test('未計測の実験は「未計測」と表示される', () => {
  const html = renderExperiments([exp({ measuredPurchases: null })], { status: 'all' }, esc);
  assert.match(html, /計測できた購入<b>未計測/);
});

test('status filter narrows the list', () => {
  const a = exp({ id: 'a', status: '仮説検証中' });
  const b = exp({ id: 'b', status: '検証済み' });
  const html = renderExperiments([a, b], { status: '検証済み' }, esc);
  assert.match(html, /1 \/ 2 件/);
});
