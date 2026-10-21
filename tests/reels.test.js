import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate } from '../lib/domain.js';
import { renderReels } from '../public/reels.js';

const esc = String;
const reel = (over = {}) => ({ id: 'r1', title: 'サンプル投稿', platform: 'Instagram', url: 'https://instagram.com/p/x',
  postedAt: '2026-10-15', durationSec: 20, theme: 'ドリブル解説', hook: '最初の3秒', format: '解説', cta: 'プロフィールへ',
  product: 'サッカーボール', campaignId: '', observedAt: '2026-10-20T00:00:00.000Z',
  views: 1000, reach: 900, avgWatchSec: 12, retentionPct: 60, saves: 50, shares: 10, comments: 5,
  followersGained: 3, profileVisits: 20, linkClicks: 2, notes: '', ...over });

test('valid reel post round-trips through validate', () => {
  const d = empty(); d.brand.Mission = 'm'; d.reelPosts.push(reel());
  const v = validate(d);
  assert.equal(v.reelPosts[0].platform, 'Instagram');
});

test('未取得（null）の指標はvalidateで許可され、0として扱われない', () => {
  const d = empty(); d.brand.Mission = 'm';
  d.reelPosts.push(reel({ views: null, avgWatchSec: null, retentionPct: null }));
  assert.doesNotThrow(() => validate(d));
});

test('負の値や100%超の維持率は拒否される', () => {
  const d = () => { const x = empty(); x.brand.Mission = 'm'; return x; };
  const a = d(); a.reelPosts.push(reel({ views: -1 })); assert.throws(() => validate(a));
  const b = d(); b.reelPosts.push(reel({ retentionPct: 101 })); assert.throws(() => validate(b));
});

test('未知の媒体・形式は拒否される', () => {
  const a = empty(); a.brand.Mission = 'm'; a.reelPosts.push(reel({ platform: 'X' }));
  assert.throws(() => validate(a));
  const b = empty(); b.brand.Mission = 'm'; b.reelPosts.push(reel({ format: '雑談' }));
  assert.throws(() => validate(b));
});

test('未取得の指標は「未取得」と表示され、0とは書かれない', () => {
  const html = renderReels([reel({ views: null, followersGained: null })], { platform: 'all', format: 'all' }, esc, '2026-10-20');
  assert.match(html, /再生<b>未取得/);
  assert.match(html, /フォロー獲得<b>未取得/);
});

test('保存率は分母（再生数）付きで表示される', () => {
  const html = renderReels([reel({ saves: 50, views: 1000 })], { platform: 'all', format: 'all' }, esc, '2026-10-20');
  assert.match(html, /5%（50 \/ 1,000）/);
});

test('再生数が未取得なら保存率も未取得と表示する（0除算にしない）', () => {
  const html = renderReels([reel({ saves: 10, views: null })], { platform: 'all', format: 'all' }, esc, '2026-10-20');
  assert.match(html, /保存率<b>未取得/);
});

test('platform filter narrows the list', () => {
  const insta = reel({ id: 'a', platform: 'Instagram' });
  const tiktok = reel({ id: 'b', platform: 'TikTok' });
  const html = renderReels([insta, tiktok], { platform: 'TikTok', format: 'all' }, esc, '2026-10-20');
  assert.match(html, /1 \/ 2 件/);
});
