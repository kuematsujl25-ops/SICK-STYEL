import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate } from '../lib/domain.js';
import { renderAccounts } from '../public/accounts.js';

const esc = String;
const acc = (over = {}) => ({ id: 'a1', accountName: 'REGATEドリブル塾', platform: 'YouTube', profileUrl: 'https://youtube.com/@x',
  postUrl: '', genre: 'ドリブル解説', observedAt: '2026-10-01', followers: 10000, publicViews: 50000,
  reaction: '', referencePoint: '企画構成', ownIdea: '', ...over });

test('valid account observation round-trips', () => {
  const d = empty(); d.brand.Mission = 'm'; d.competitorAccounts.push(acc());
  assert.equal(validate(d).competitorAccounts[0].accountName, 'REGATEドリブル塾');
});

test('空のアカウント名は拒否される', () => {
  const d = empty(); d.brand.Mission = 'm'; d.competitorAccounts.push(acc({ accountName: '' }));
  assert.throws(() => validate(d));
});

test('フォロワー数はnull（未取得）を許可する', () => {
  const d = empty(); d.brand.Mission = 'm'; d.competitorAccounts.push(acc({ followers: null }));
  assert.doesNotThrow(() => validate(d));
});

test('観測が1回だけのアカウントは増加率未確認と表示される', () => {
  const html = renderAccounts([acc()], { platform: 'all' }, esc);
  assert.match(html, /増加率未確認（観測1回のみ）/);
});

test('観測が2回あるアカウントは増加率を計算する', () => {
  const a = acc({ id: 'a1', observedAt: '2026-09-01', followers: 10000 });
  const b = acc({ id: 'a2', observedAt: '2026-10-01', followers: 12000 });
  const html = renderAccounts([a, b], { platform: 'all' }, esc);
  assert.match(html, /\+20%/);
});

test('異なるアカウントの観測数は互いに影響しない', () => {
  const a1 = acc({ id: 'a1', accountName: 'アカウントA', observedAt: '2026-09-01', followers: 1000 });
  const a2 = acc({ id: 'a2', accountName: 'アカウントA', observedAt: '2026-10-01', followers: 1100 });
  const b1 = acc({ id: 'b1', accountName: 'アカウントB', observedAt: '2026-10-01', followers: 500 });
  const html = renderAccounts([a1, a2, b1], { platform: 'all' }, esc);
  assert.match(html, /アカウントB[\s\S]*増加率未確認（観測1回のみ）/);
});

test('platform filter narrows the list', () => {
  const yt = acc({ id: 'a', platform: 'YouTube' });
  const ig = acc({ id: 'b', platform: 'Instagram', accountName: '別アカウント' });
  const html = renderAccounts([yt, ig], { platform: 'Instagram' }, esc);
  assert.match(html, /1 \/ 2 件/);
});
