import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empty, validate } from '../lib/domain.js';
import { renderPlayers } from '../public/players.js';

const esc = String;
const player = (over = {}) => ({ id: 'p1', name: '俵積田晃太', league: 'Jリーグ', tier: '候補', affiliation: '鹿島アントラーズ',
  position: 'FW', profileUrl: '', videoUrl: '', dribbleAttempts: null, successRate: null, playTimeMin: null,
  period: '', source: '', brandFitReason: '', confirmItems: '契約費・連絡可否は未確認', negotiationStatus: '未接触', ...over });

test('valid player candidate round-trips', () => {
  const d = empty(); d.brand.Mission = 'm'; d.playerCandidates.push(player());
  assert.equal(validate(d).playerCandidates[0].tier, '候補');
});

test('dribbleAttempts/successRate/playTimeMinはnull（未取得）を許可する', () => {
  const d = empty(); d.brand.Mission = 'm'; d.playerCandidates.push(player());
  assert.doesNotThrow(() => validate(d));
});

test('successRateは0〜1の範囲外を拒否する', () => {
  const d = empty(); d.brand.Mission = 'm'; d.playerCandidates.push(player({ successRate: 1.5 }));
  assert.throws(() => validate(d));
});

test('未知の区分・リーグは拒否される', () => {
  const a = empty(); a.brand.Mission = 'm'; a.playerCandidates.push(player({ tier: 'エース' }));
  assert.throws(() => validate(a));
  const b = empty(); b.brand.Mission = 'm'; b.playerCandidates.push(player({ league: 'アジア' }));
  assert.throws(() => validate(b));
});

test('空の名前は拒否される', () => {
  const d = empty(); d.brand.Mission = 'm'; d.playerCandidates.push(player({ name: '' }));
  assert.throws(() => validate(d));
});

test('候補と提供済みは区分バッジで区別される', () => {
  const html = renderPlayers([player({ tier: '候補' }), player({ id: 'p2', name: '提供選手', tier: '提供済み' })], { league: 'all', tier: 'all' }, esc);
  assert.match(html, /badge ">候補/);
  assert.match(html, /badge ok">提供済み/);
});

test('未取得のドリブル試行数・成功率は「未取得」と表示される', () => {
  const html = renderPlayers([player()], { league: 'all', tier: 'all' }, esc);
  assert.match(html, /ドリブル試行<b>未取得/);
  assert.match(html, /成功率<b>未取得/);
});

test('tier filter narrows the list', () => {
  const a = player({ id: 'a', tier: '候補' });
  const b = player({ id: 'b', tier: '提供済み', name: '別選手' });
  const html = renderPlayers([a, b], { league: 'all', tier: '提供済み' }, esc);
  assert.match(html, /1 \/ 2 件/);
});
