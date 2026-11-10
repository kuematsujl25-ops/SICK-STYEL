import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireWranglerLogin} from '../scripts/lib/wrangler-auth.js';

test('Wranglerの正常な複数行JSONを認証済みと判定する（P1回帰）',()=>{
  const stdout=JSON.stringify({loggedIn:true,authType:'oauth',accounts:[{name:'fixture',id:'fixture-account'}]},null,4)+'\n';
  assert.doesNotThrow(()=>requireWranglerLogin({status:0,stdout}));
  assert.doesNotThrow(()=>requireWranglerLogin({status:0,stdout:' {"loggedIn":true} \n'}));
});

test('明示的な未ログイン応答だけに本人ログインを案内する',()=>{
  for(const status of [0,1])assert.throws(()=>requireWranglerLogin({status,stdout:JSON.stringify({loggedIn:false},null,4)}),/Cloudflare本人ログイン/);
});

test('CLI依存欠落・不正JSON・不正スキーマを未ログインと誤判定しない',()=>{
  for(const stdout of ['', 'Error: Cannot find module esbuild', '{"loggedIn":true',
    'prefix\n{"loggedIn":true}', 'null', '[]', '{}', '{"loggedIn":"true"}']){
    assert.throws(()=>requireWranglerLogin({status:1,stdout}),error=>
      /Wrangler/.test(error.message)&&!/Cloudflare本人ログイン/.test(error.message));
  }
});

test('認証済みJSONでもプロセス失敗・中断は拒否し、アカウント情報をエラーに出さない',()=>{
  const stdout=JSON.stringify({loggedIn:true,email:'private-fixture@example.com',accounts:[{id:'private-fixture-id'}]},null,4);
  for(const result of [{status:1,stdout},{status:null,signal:'SIGTERM',stdout},
    {status:null,error:{code:'ETIMEDOUT'},stdout}])
    assert.throws(()=>requireWranglerLogin(result),error=>
      !/private-fixture/.test(error.message)&&!/Cloudflare本人ログイン/.test(error.message));
});
