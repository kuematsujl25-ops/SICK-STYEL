import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {TASK_PACKET_MAX_BYTES,taskPacketBytes,createJob,taskPacket,validateTaskPacket,
  digest,emptyTeam,transitionTeam,TeamError} from '../lib/ai-team.js';
const root=fileURLToPath(new URL('../',import.meta.url)),now='2026-10-20T00:00:00.000Z';
const jobId='30000000-0000-4000-8000-000000000001';
const inputOf=p=>({role:p.role,title:p.title,objective:p.objective,facts:p.facts});
function sizedPacket(bytes){
  const p={version:1,job_id:jobId,input_hash:'0'.repeat(64),business_unit:'sickstyle',role:'coo',title:'架空',objective:'確認',
    facts:Array.from({length:30},(_,i)=>({id:'f'+i,label:'架空',value:'x',unit:'JPY',source:'x',observed_at:now,kind:'observed'}))};
  let left=bytes-taskPacketBytes(p);
  const slots=p.facts.flatMap(f=>[[f,'value',500],[f,'source',500],[f,'label',100],[f,'unit',50]]);
  for(const [o,k,max] of slots){const count=Math.min(max-o[k].length,Math.floor(left/3));o[k]+='あ'.repeat(count);left-=count*3;}
  for(const [o,k,max] of slots){const count=Math.min(max-o[k].length,left);o[k]+='x'.repeat(count);left-=count;}
  assert.equal(left,0,'fixture capacity');
  p.input_hash=digest({business_unit:'sickstyle',...inputOf(p)});
  assert.equal(taskPacketBytes(p),bytes);
  return p;
}

test('packet: 100KB UTF-8上限をAPI作成・書出・CLIが共有し、日本語30factsを保存前に拒否',()=>{
  assert.equal(TASK_PACKET_MAX_BYTES,100000);
  const p=sizedPacket(100001);
  assert.ok(JSON.stringify(p).length<100000,'文字数だけでは拒否できない');
  assert.throws(()=>createJob(inputOf(p),now),TeamError);
  const state=transitionTeam(emptyTeam(),{action:'toggle',enabled:true},now);
  assert.throws(()=>transitionTeam(state,{action:'create',job:inputOf(p)},now),TeamError);
  assert.equal(state.jobs.length,0,'拒否時に保存状態を変更しない');
  assert.throws(()=>validateTaskPacket(p),TeamError);
  assert.throws(()=>taskPacket({id:p.job_id,...inputOf(p),input_hash:p.input_hash}),TeamError,'旧大容量依頼も無断に切り捨てない');
});

test('packet: 境界-1/境界は標準整形とminifiedの両方でCLI準備確認まで通り、境界+1は拒否',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ss-packet-size-'));
  try{
    for(const size of [99999,100000,100001]){
      const p=sizedPacket(size);
      if(size<=100000){
        const made=taskPacket(createJob(inputOf(p),now));
        assert.equal(taskPacketBytes(made),size);assert.deepEqual(validateTaskPacket(made),made);
      }
      for(const [style,text] of [['compact',JSON.stringify(p)],['pretty',JSON.stringify(p,null,2)+'\n']]){
        const file=join(dir,size+'-'+style+'.json');writeFileSync(file,text);
        const r=spawnSync(process.execPath,[join(root,'scripts/ai-staff/run-task.js'),file,'--provider','claude'],
          {encoding:'utf8',env:{PATH:'/nonexistent'},timeout:10000});
        assert.equal(r.status,size<=100000?0:1,r.stderr);
        if(size<=100000)assert.match(r.stdout,/準備確認のみ/);else assert.match(r.stderr,/100KB/);
      }
    }
    const file=join(dir,'padded.json');writeFileSync(file,JSON.stringify(sizedPacket(100000),null,2)+'\n ');
    const r=spawnSync(process.execPath,[join(root,'scripts/ai-staff/run-task.js'),file,'--provider','claude','--run'],
      {encoding:'utf8',env:{PATH:'/nonexistent'},timeout:10000});
    assert.equal(r.status,1);assert.match(r.stderr,/100KB/,'過剰な整形余白も認証前に拒否');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('PR4統合: 既存hooksを無効化する起動引数を戻さず、preflightのkeep-varsを維持',()=>{
  const runner=readFileSync(join(root,'scripts/ai-staff/run-task.js'),'utf8');
  const delegate=readFileSync(join(root,'scripts/ai-staff/delegate.js'),'utf8');
  assert.ok(!/disableAllHooks\s*["']?\s*:\s*true|--disable[ -]hooks|--setting-sources/.test(runner+delegate));
  const deployment=readFileSync(join(root,'scripts/deploy-existing.js'),'utf8');
  assert.match(deployment,/--keep-vars/);assert.match(deployment,/checkReadiness/);
});
