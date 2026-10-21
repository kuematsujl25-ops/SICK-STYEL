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
