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

test('priority/sampleStatus/homepageStatusは省略可能（旧データ互換）、未知の値は拒否される', () => {
  const d = empty(); d.brand.Mission = 'm'; d.playerCandidates.push(player());
  assert.doesNotThrow(() => validate(d));
  const withFields = empty(); withFields.brand.Mission = 'm'; withFields.playerCandidates.push(player({ priority: '高', sampleStatus: '提供準備中', updatedAt: '2026-10-21T00:00:00.000Z' }));
  const r = validate(withFields).playerCandidates[0];
  assert.equal(r.priority, '高'); assert.equal(r.sampleStatus, '提供準備中');
  const badPriority = empty(); badPriority.brand.Mission = 'm'; badPriority.playerCandidates.push(player({ priority: '最優先' }));
  assert.throws(() => validate(badPriority));
  const badSample = empty(); badSample.brand.Mission = 'm'; badSample.playerCandidates.push(player({ sampleStatus: '発送済み' }));
  assert.throws(() => validate(badSample));
});

test('ホームページ掲載は「提供済み」区分の候補にしか許可されない（候補を勝手に公開できない）', () => {
  const asProvided = empty(); asProvided.brand.Mission = 'm'; asProvided.playerCandidates.push(player({ tier: '提供済み', homepageStatus: '公開済み' }));
  assert.doesNotThrow(() => validate(asProvided));
  const asCandidate = empty(); asCandidate.brand.Mission = 'm'; asCandidate.playerCandidates.push(player({ tier: '候補', homepageStatus: '掲載候補' }));
  assert.throws(() => validate(asCandidate));
  const nonPublishedCandidate = empty(); nonPublishedCandidate.brand.Mission = 'm'; nonPublishedCandidate.playerCandidates.push(player({ tier: '候補', homepageStatus: '非掲載' }));
  assert.doesNotThrow(() => validate(nonPublishedCandidate));
});

test('優先度バッジとデータ更新日時がカードに表示される（未記録の旧データは明示する）', () => {
  const withPriority = player({ priority: '高', updatedAt: '2026-10-21T09:00:00.000Z' });
  const html = renderPlayers([withPriority], { league: 'all', tier: 'all' }, esc);
  assert.match(html, /優先度 高/);
  assert.match(html, /データ更新: 2026/);
  const legacy = renderPlayers([player()], { league: 'all', tier: 'all' }, esc);
  assert.match(legacy, /データ更新: 未記録（旧データ）/);
});
