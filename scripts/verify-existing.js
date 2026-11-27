// Read-only smoke check. Does not create admin sessions or production records.
import assert from 'node:assert/strict';
const origin = 'https://sickstyle-manager.sickstyle-74h4.workers.dev';
try {
  const get = path => fetch(origin+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
  for (const path of ['/','/app.js','/ai-team.js','/ai-catalog.js','/finance.js']) {
    const r = await get(path); assert.equal(r.status,200,'GET '+path);
    const type = r.headers.get('content-type');
    assert.match(type,path==='/'?/text\/html/:/javascript/,'Content-Type '+path);
    if (path==='/app.js') assert.match(await r.text(),/renderTeam/);
  }
  const session = await (await get('/api/session')).json();
  assert.equal(session.configured,true); assert.equal(session.authenticated,false); assert.equal(session.storage,'d1');
  for (const path of ['/api/ai-team','/api/ai-team/export','/api/ai-team/task?job_id=probe']) {
    const r = await get(path); assert.equal(r.status,401,'unauthenticated '+path);
    assert.match(r.headers.get('cache-control'),/no-store/);
  }
  console.log('読み取り検証成功: 配信5件・D1セッション・未認証のAI社員API拒否3件');
} catch { console.error('本番読み取り検証が完了しませんでした（業務データの変更なし）'); process.exitCode=1; }
