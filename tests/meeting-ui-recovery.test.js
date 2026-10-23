import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const block=src.slice(src.indexOf(" d.querySelectorAll('[data-mtgsync]')"),src.indexOf(" document.querySelector('#close')",src.indexOf(" d.querySelectorAll('[data-mtgsync]')")));
test('会議API失敗後は最新revisionとuncertain状態を再取得し、失敗時は古い操作画面を閉じる',async()=>{
 for(const failRead of [false,true]){const btn={dataset:{mtgsync:'initial:create'},disabled:false},calls=[];let shown=null,closed=false;
 const c=vm.createContext({d:{querySelectorAll:()=>[btn],close:()=>closed=true},record:{id:'qa'},state:{revision:1},orgFormHasUnsavedChanges:()=>false,toast:()=>{},render:()=>{},orgEditor:x=>shown=x,api:async route=>{calls.push(route);if(route==='orgsales/meeting'||failRead)throw Error('dummy');return {revision:3,orgSales:[{id:'qa',initialMeetingSync:{status:'uncertain'}}]};}});
 vm.runInContext(block,c);await btn.onclick();assert.deepEqual(calls,['orgsales/meeting','data']);if(failRead)assert.ok(closed);else{assert.equal(c.state.revision,3);assert.equal(shown.initialMeetingSync.status,'uncertain');}
 }
});
