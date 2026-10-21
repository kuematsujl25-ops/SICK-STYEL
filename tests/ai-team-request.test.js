import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderTeam} from '../public/ai-team.js';
import {TEAM_CATALOG} from '../public/ai-catalog.js';
import {emptyTeam,transitionTeam} from '../lib/ai-team.js';

const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');

test('stopped AI team shows actionable first request submission, not a disabled button',()=>{
 const html=renderTeam({state:emptyTeam(),catalog:TEAM_CATALOG},esc);
 assert.match(html,/手動運用を開始して依頼を保存/);
 assert.doesNotMatch(html,/<button class="primary" disabled>依頼を保存/);
 assert.match(html,/Mac上のAIランナーを起動していればClaude Codeが自動で分析/);
});

test('first request is stored only after explicit manual-mode activation',()=>{
 const initial=emptyTeam();
 assert.throws(()=>transitionTeam(initial,{action:'create',job:{role:'market',title:'調査',objective:'ドリブラー候補の比較',facts:[]}}),/停止中/);
 const started=transitionTeam(initial,{action:'toggle',enabled:true});
 const created=transitionTeam(started,{action:'create',job:{role:'market',title:'調査',objective:'ドリブラー候補の比較',facts:[]}});
 assert.equal(created.jobs.length,1);
 assert.equal(created.jobs[0].status,'queued');
 assert.equal(created.audit.filter(x=>x.action==='job_created').length,1);
 assert.equal(initial.enabled,false);
});

test('Claude Code copy flow is available but does not pretend to execute AI',()=>{
 const js=readFileSync(new URL('../public/ai-team.js',import.meta.url),'utf8');
 assert.match(js,/data-team-copy/);
 assert.match(js,/navigator\.clipboard\.writeText/);
 assert.match(js,/分析結果は管理アプリに自動反映されません/);
});
