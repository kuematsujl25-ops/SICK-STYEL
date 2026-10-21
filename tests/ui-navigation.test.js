import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('desktop sidebar can scroll independently within the viewport',()=>{
 const sidebar=css.match(/^aside\{[^}]*\}/m)?.[0]||'';
 const nav=css.match(/^nav\{[^}]*\}/m)?.[0]||'';
 assert.match(sidebar,/max-height:100dvh/);
 assert.match(nav,/flex:1 1 auto/);
 assert.match(nav,/min-height:0/);
 assert.match(nav,/overflow-y:auto/);
 assert.match(nav,/overscroll-behavior-y:contain/);
});

test('mobile navigation remains horizontal',()=>{
 const mobile=css.match(/@media\(max-width:720px\)\{([\s\S]*?)\n\}/)?.[1]||'';
 assert.match(mobile,/max-height:none;overflow:visible/);
 assert.match(mobile,/nav\{[^}]*overflow-x:auto;overflow-y:hidden/);
});

test('navigation keeps its scroll position across page rerenders',()=>{
 assert.match(js,/const navScrollTop=previousNav\?\.scrollTop/);
 assert.match(js,/currentNav\.scrollTop=navScrollTop;currentNav\.scrollLeft=navScrollLeft/);
});

test('Instagram and Amazon screens include connection setup guides and app JS parses',()=>{
 assert.match(js,/Instagram連携の手順（5ステップ）/);
 assert.match(js,/Amazon SP-API連携の手順（5ステップ）/);
 assert.match(js,/\/api\/instagram\/callback/);
 const check=spawnSync(process.execPath,['--check','public/app.js'],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr||check.stdout);
});

test('menu no longer lists the consolidated/removed sections, and keeps the others',()=>{
 const navLine=js.match(/^const nav=\[.*\];$/m)?.[0]||'';
 for(const removed of ['orgSales','collectionTasks','growthExperiments','playerCandidates','finance','reelPosts','competitorAccounts',"['metrics'"])
  assert.doesNotMatch(navLine,new RegExp("'"+removed.replace(/^\['/,'')+"'"),removed+' should no longer be a top-level menu item');
 for(const kept of ['overview','goals','tasks','staffTasks','shipments','team','amazon','instagram','site','brand','settings'])
  assert.match(navLine,new RegExp("'"+kept+"'"),kept+' should remain a top-level menu item');
});

test('consolidated features are rendered inside Instagram/Amazon instead of their own screens',()=>{
 assert.match(js,/renderReels\(state\.reelPosts/);
 assert.match(js,/renderAccounts\(state\.competitorAccounts/);
 assert.match(js,/renderSnsMetrics\(state\.metrics/);
 assert.match(js,/広告費用対効果/);
 assert.match(js,/売上に関わりうる要因の整理（相関ではありません）/);
 assert.match(js,/因果関係・相関係数を計算・断定したものではありません/);
});

test('no inline style attributes are used anywhere in app.js (CSP style-src \'self\' blocks them silently)',()=>{
 assert.doesNotMatch(js,/\sstyle="/,'inline style="..." is silently dropped by the existing Content-Security-Policy (style-src \'self\'); use CSS classes instead');
});
