import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createJob,taskPacket,validateTaskPacket,TeamError} from '../lib/ai-team.js';
import {resultPath} from '../scripts/ai-staff/result-path.js';

const packet=()=>taskPacket(createJob({role:'creative',title:'架空の依頼',objective:'不足情報を確認する',facts:[]},new Date().toISOString()));
const invalidIds=['../../export','../public/leak','/tmp/leak','..\\..\\public\\leak',
  '%2e%2e%2fexport','file:///tmp/leak','','x',null,{},
  '11111111-1111-1111-8111-111111111111','11111111-1111-4111-7111-111111111111',
  '11111111-1111-4111-8111-111111111111/../leak',
  '11111111-1111-4111-8111-111111111111\n'];

test('P2回帰: 正しい入力ハッシュでもパスを含む依頼IDを拒否',()=>{
  const task=packet();assert.equal(validateTaskPacket(task).job_id,task.job_id);
  for(const job_id of invalidIds)
    assert.throws(()=>validateTaskPacket({...task,job_id}),TeamError);
});

test('成果物ファイルは専用ディレクトリ直下のUUID名に限定',()=>{
  const task=packet(),executionId=randomUUID();
  const directory=join(tmpdir(),'sickstyle-private-results');
  const path=resultPath(directory,task.job_id,executionId);
  assert.equal(dirname(path),resolve(directory));
  assert.equal(path,join(directory,`${task.job_id}-${executionId}.json`));
  for(const id of invalidIds){
    assert.throws(()=>resultPath(directory,id,executionId),TeamError);
    assert.throws(()=>resultPath(directory,task.job_id,id),TeamError);
  }
});

test('不正な依頼IDはCLI認証・モデル実行・ファイル書込みの前に停止',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ss-traversal-test-'));
  try{
    const bin=join(dir,'bin');mkdirSync(bin);
    const marker=join(dir,'cli-was-called');
    writeFileSync(join(bin,'codex'),`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'called');process.exit(1);`,{mode:0o700});
    const filename=join(dir,'task.json');
    for(const job_id of ['../../export','../public/leak','/tmp/leak']){
      writeFileSync(filename,JSON.stringify({...packet(),job_id}));
      const result=spawnSync(process.execPath,['scripts/ai-staff/run-task.js',filename,'--run'],
        {encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH}});
      assert.equal(result.status,1);assert.match(result.stderr,/UUID/);
      assert.equal(existsSync(marker),false);
    }
    assert.deepEqual(readdirSync(dir).sort(),['bin','task.json']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
