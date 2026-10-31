import {test} from 'node:test';
import assert from 'node:assert/strict';
import {empty,validate} from '../lib/domain.js';
import {newOrg,ORG_PHASES} from '../public/org-sales.js';
import {googleCalendarDraft} from '../public/meeting-links.js';
import {RESEARCHED_PLAYERS,toCandidate} from '../public/player-research.js';

test('org funnel has exactly the requested 6 stages, while detailed history is preserved',()=>{
 assert.deepEqual(ORG_PHASES.map(x=>x[0]),['DM','ZOOM','サンプル','試用','活用法提案ZOOM','導入']);
 assert.ok(ORG_PHASES.some(x=>x.includes('初回ZOOM実施')));
 assert.ok(ORG_PHASES.some(x=>x.includes('活用法提案ZOOM予約')));
});

test('meeting schedule is optional for legacy organizations and valid on save/restore',()=>{
 const old={...newOrg(),id:'org-1',name:'FC Example',updatedAt:'2026-10-21T06:00:00.000Z',deletedAt:null,
 history:[{stage:'DM送信',at:'2026-10-21T06:00:00.000Z',note:''}]};
 delete old.initialZoomAt;delete old.initialZoomUrl;delete old.proposalZoomAt;delete old.proposalZoomUrl;
 const document={...empty(),orgSales:[old]};
 assert.equal(validate(document).orgSales[0].name,'FC Example');
 const modified={...old,initialZoomAt:'2026-10-28T14:00',initialZoomUrl:'https://zoom.us/j/123456',proposalZoomAt:'2026-11-03T16:00',proposalZoomUrl:''};
 const result=validate({...document,orgSales:[modified]});
 assert.equal(result.orgSales[0].initialZoomAt,'2026-10-28T14:00');
 assert.equal(result.orgSales[0].initialZoomUrl,'https://zoom.us/j/123456');
 assert.throws(()=>validate({...document,orgSales:[{...modified,initialZoomUrl:'javascript:alert(1)'}]}));
});

test('Google Calendar link is a draft, with correct JST to UTC conversion',()=>{
 const url=googleCalendarDraft({name:'Aチーム',initialZoomAt:'2026-10-28T14:00',initialZoomUrl:'https://zoom.us/j/123'},'intro');
 const u=new URL(url);
 assert.equal(u.hostname,'calendar.google.com');
 assert.equal(u.searchParams.get('action'),'TEMPLATE');
 assert.equal(u.searchParams.get('dates'),'20261028T050000Z/20261028T054500Z');
 assert.match(u.searchParams.get('details'),/zoom.us/);
 assert.equal(googleCalendarDraft({initialZoomAt:''},'intro'),null);
});

test('researched prospects are sourced and never seeded as provided players',()=>{
 assert.equal(RESEARCHED_PLAYERS.length,8);
 assert.ok(RESEARCHED_PLAYERS.some(x=>x.league==='Jリーグ'));
 assert.ok(RESEARCHED_PLAYERS.some(x=>x.league==='海外'));
 for(const p of RESEARCHED_PLAYERS){
  assert.match(p.sourceUrl,/^https:\/\//);
  assert.notEqual(p.tier,'提供済み');
  const c=toCandidate(p);
  assert.equal(c.successRate,null);
  assert.equal(c.feintCount,null);
  assert.equal(c.negotiationStatus,'未接触');
  const data=validate({...empty(),playerCandidates:[{...c,id:'a1'}]});
  assert.equal(data.playerCandidates.length,1);
 }
 const c=toCandidate(RESEARCHED_PLAYERS[0]);
 assert.throws(()=>validate({...empty(),playerCandidates:[{...c,id:'a1',photoUrl:'javascript:alert(1)'}]}));
});
