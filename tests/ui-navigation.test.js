import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');

test('本番(workers/index.js)とローカル開発(server.js)のContent-Security-Policyは同じimg-src（選手候補の写真表示に必要なhttps:を含む）を使う（Codex独立レビュー指摘の回帰：production/localの設定が分岐しないようにする）',()=>{
 const workers=readFileSync(new URL('../workers/index.js',import.meta.url),'utf8');
 const serverJs=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const csp=/img-src 'self' data: https:/;
 assert.match(workers,csp,'workers/index.js（本番）');
 assert.match(serverJs,csp,'server.js（ローカル開発）');
});

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
 assert.match(js,/売上に関わりうる要因の整理/);
 assert.match(js,/相関係数の計算や因果関係の断定はしていません/);
});

test('no inline style attributes are used anywhere in app.js (CSP style-src \'self\' blocks them silently)',()=>{
 assert.doesNotMatch(js,/\sstyle="/,'inline style="..." is silently dropped by the existing Content-Security-Policy (style-src \'self\'); use CSS classes instead');
});

test('広告CSV取込は、広告費・広告経由売上のセルが空欄でないのにtoNumber()で解析できない場合（誤入力・負数・桁超過など）、nullとして既存の値を無言で上書きせず行を除外する（Codex独立レビュー指摘の回帰）',()=>{
 const fn=js.match(/function adCsvImport\(input\)\{[\s\S]*?\n\}/)?.[0]||'';
 assert.ok(fn,'adCsvImport関数が見つかる');
 assert.match(fn,/numericCell=idx=>\{if\(idx<0\|\|r\[idx\]===''\)return \{value:null,invalid:false\};const v=toNumber\(r\[idx\]\);return \{value:v,invalid:v===null\};\}/,'空欄は許容、非空欄の解析失敗はinvalidとして区別する');
 assert.match(fn,/costCell\.invalid\|\|salesCell\.invalid/,'解析失敗したセルは行の除外条件(bad.push)に含まれる');
});

test('AI社員の依頼保存で「未運用→運用開始」のトグルが成功した直後に依頼作成が失敗しても、bindTeamに束縛されたmodelが更新され、以後の操作（トグル・再送信）が古いrevisionを使い続けない（Codex独立レビュー指摘の回帰）',()=>{
 const aiTeamJs=readFileSync(new URL('../public/ai-team.js',import.meta.url),'utf8');
 const toggleBlock=aiTeamJs.match(/if\(!model\.state\.enabled\)\{[\s\S]*?\n \}/)?.[0]||'';
 assert.ok(toggleBlock,'トグル成功時の処理ブロックが見つかる');
 assert.match(toggleBlock,/model=started/,'bindTeamに束縛されたmodel自体を更新する（setModel()はアプリ全体のstateしか更新しないため）');
});

test('CSV取込等でinstagramEntered:falseの売上記録も、renderSnsMetricsの一覧（metrics唯一の編集入口）から除外されず編集・削除できる（Codex独立レビュー指摘の回帰：ナビ整理後、取込済みの売上記録を直す・消す手段がどの画面にも無くなっていた）',()=>{
 const fn=js.match(/function renderSnsMetrics\(metrics,esc\)\{[\s\S]*?\n\}/)?.[0]||'';
 assert.ok(fn,'renderSnsMetrics関数が見つかる');
 assert.doesNotMatch(fn,/filter\(m=>m\.instagramEntered/,'instagramEntered:falseの行を一覧から除外していない');
 assert.match(fn,/data-edit="metrics:/,'各行に編集ボタンが出る（除外された行を含む）');
});

test('MTG連携ボタンはフォームに未保存の変更がある間は同期を実行しない（Codex独立レビュー指摘の回帰：保存前の値が古いまま同期され、同期後の再描画で未保存の入力が失われるのを防ぐ）',()=>{
 assert.match(js,/function orgFormHasUnsavedChanges\(record\)/);
 const handler=js.match(/d\.querySelectorAll\('\[data-mtgsync\]'\)\.forEach\(btn=>btn\.onclick=async\(\)=>\{[\s\S]*?\n \}\);/)?.[0]||'';
 assert.match(handler,/orgFormHasUnsavedChanges\(record\)/,'MTG連携ボタンのクリック処理が未保存チェックを呼んでいる');
 const guardIndex=handler.search(/orgFormHasUnsavedChanges\(record\)/);
 const apiCallIndex=handler.search(/api\('orgsales\/meeting'/);
 assert.ok(guardIndex>=0&&apiCallIndex>guardIndex,'未保存チェックはAPI呼び出しより前に行われる');
});
