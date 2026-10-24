// SICK STYLE AI社員の任意Mac常駐ランナー。
// 既存管理者の本人ログイン（セッションはメモリのみ）とClaude Code本人購読を使い、
// 管理画面で保存された依頼を自動分析して既存のレビュー待ちへ取り込む。
// サーバーに追加の実行権限や有料APIキーを登録しない。Macが停止中は自動実行されない。
import {spawn as spawnChild} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ask,secret,requireTerminal} from '../lib/prompt.js';
import {checkSubscription} from './cli.js';
import {randomUUID} from 'node:crypto';
import {validateTaskPacket} from '../../lib/ai-team.js';

const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const DEFAULT_ORIGIN='https://sickstyle-manager.sickstyle-74h4.workers.dev';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const log=s=>console.log(s);
const fail=s=>{throw Error(s);};

function argumentsFor(argv){
 let once=false,interval=15000;
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--once'&&!once)once=true;
  else if(argv[i]==='--interval'&&argv[i+1]&&/^\d+$/.test(argv[i+1])){
   const n=Number(argv[++i]);if(n<10||n>300)fail('間隔は10〜300秒を指定してください');interval=n*1000;
  }else fail('使用方法: npm run ai:runner -- [--once] [--interval 15]');
 }
 return {once,interval};
}
function sessionCookie(header){
 const m=String(header||'').match(/(?:^|,\s*)session=([a-f0-9]{40,256})(?=;|$)/i);
 if(!m)fail('ログインCookieを受け取れませんでした（本番URLと管理者を確認してください）');
 return 'session='+m[1];
}
export async function signIn({origin=DEFAULT_ORIGIN,email,password,request=fetch}){
 if(origin!==DEFAULT_ORIGIN)fail('本番以外の接続先へ認証情報を送信しません');
 const res=await request(origin+'/api/login',{
  method:'POST',headers:{'Content-Type':'application/json','Origin':origin},
  body:JSON.stringify({email,password})
 });
 if(!res.ok)fail('管理アプリにログインできませんでした（HTTP '+res.status+'）。管理者情報と回数制限を確認してください');
 return sessionCookie(res.headers.get('set-cookie'));
}
export async function api(cookie,path,{method='GET',data,origin=DEFAULT_ORIGIN,request=fetch}={}){
 if(origin!==DEFAULT_ORIGIN)fail('接続先が許可されていません');
 const response=await request(origin+'/api/'+path,{
  method,
  headers:{Cookie:cookie,'Origin':origin,...(data?{'Content-Type':'application/json'}:{})},
  body:data?JSON.stringify(data):undefined
 });
 const txt=await response.text();
 let json;try{json=JSON.parse(txt);}catch{fail('API応答がJSONではありません（HTTP '+response.status+'）');}
 if(!response.ok)fail('管理アプリAPI '+path+' がHTTP '+response.status+'を返しました。'+
  (response.status===401?'セッションが期限切れです。ランナーを再起動してログインしてください。':
   response.status===409?'他端末で更新されています。再読み込みが必要です。':'管理者画面の状態を確認してください。'));
 return json;
}
export function proactiveAllowed(model,job){return !job?.proactiveSource||!!(model.proactive?.state?.enabled&&model.proactive.state.modelQueue&&model.proactive.state.permissions?.[job.proactiveSource]);}
export function eligibleJob(model,seen=new Set(),staffOnly=false){
 if(!model?.state?.enabled||!Array.isArray(model.state.jobs))return null;
 return model.state.jobs.find(j=>(!staffOnly||j.proactiveSource==='staffTasks')&&j.status==='queued'&&j.attempts<2&&(j.run_attempts||0)<2&&!j.intake&&!seen.has(j.id+':'+(j.run_attempts||0))&&!seen.has(j.id)&&proactiveAllowed(model,j))||null;
}
export function artifactAfter(before,jobId,resultDir){
 const names=readdirSync(resultDir).filter(f=>f.startsWith(jobId+'-')&&
  /^[0-9a-f-]{36}-[0-9a-f-]{36}\.json$/.test(f)&&!before.has(f));
 if(names.length!==1)fail('成果物JSONを一意に確認できません。結果は管理画面から手動で取り込んでください');
 return join(resultDir,names[0]);
}
export function spawnAnalysis(command,args,options,signal){
 return new Promise((resolve,reject)=>{
  const child=spawnChild(command,args,{...options,stdio:'ignore',detached:true});
  const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}};
  const shutdown=()=>{stop();process.exit(130);};process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);process.once('exit',stop);
  const timer=setTimeout(stop,205000);const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)stop();
  child.once('error',finishError);child.once('close',code=>{cleanup();resolve({status:code});});
  function cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',abort);process.removeListener('SIGINT',shutdown);process.removeListener('SIGTERM',shutdown);process.removeListener('exit',stop);}
  function finishError(e){cleanup();reject(e);}
 });
}
export async function runClaude(packet,{spawn=spawnAnalysis,signal}={}){
 validateTaskPacket(packet);
 const temp=mkdtempSync(join(tmpdir(),'sickstyle-auto-runner-'));
 try{
  const input=join(temp,'task.json');
  writeFileSync(input,JSON.stringify(packet,null,2)+'\n',{mode:0o600});
  const resultDir=resolve(ROOT,'data/ai-results');
  mkdirSync(resultDir,{recursive:true,mode:0o700});
  const before=new Set(readdirSync(resultDir));
  const run=await spawn(process.execPath,['scripts/ai-staff/run-task.js',input,'--provider','claude','--run'],
   {cwd:ROOT,encoding:'utf8',timeout:205000,maxBuffer:1000000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}},signal);
  if(run.status!==0)fail('Claude Code分析が完了しませんでした。購読上限・本人ログイン・CLIバージョンを確認してください（再実行は自動では行いません）');
  const outputFile=artifactAfter(before,packet.job_id,resultDir);
  if(!existsSync(outputFile))fail('Claudeの成果物が見つかりません');
  const result=JSON.parse(readFileSync(outputFile,'utf8'));
  if(result.job_id!==packet.job_id||result.input_hash!==packet.input_hash||result.provider!=='claude')
   fail('成果物の依頼IDまたは入力ハッシュが一致しません');
  return {result,outputFile};
 }finally{rmSync(temp,{force:true,recursive:true});}
}
export function validateStaffAggregate(packet){
 const facts=packet.facts;
 if(packet.role!=='coo'||packet.title!=='自動業務分析：期限超過タスク'||packet.objective!=='根拠の件数と未確認事項から、確認の優先順位・改善案・必要な追加データを提示してください。個別の事実や原因は未取得です。外部操作は実行しないでください。'||facts.length!==2)fail('匿名の期限超過集計以外は送信しません');
 const [count,evidence]=facts;
 if(count.id!=='count'||count.label!=='期限と状態に該当する記録数'||count.unit!=='件'||count.source!=='SICK STYLE 保存済み staffTasks'||count.kind!=='observed'||!Number.isSafeInteger(count.value)||count.value<=0||evidence.id!=='evidence'||evidence.label!=='対象根拠の識別ハッシュ'||evidence.unit!=='識別子'||evidence.source!=='保存データの期限・更新日時・状態'||evidence.kind!=='observed'||!/^([a-f0-9]{64})$/.test(evidence.value))fail('匿名集計の形式を確認できません');
}
export async function oneCycle(cookie,seen,{run=runClaude,request=fetch,heartbeatMs=30000,staffOnly=false,onLog=()=>{}}={}){
 const current=await api(cookie,'ai-team',{request});const job=eligibleJob(current,seen,staffOnly);
 if(!job)return {processed:false};
 const claim_id=randomUUID();
 // CAS claim is never retried blindly. Unknown responses leave a lease, not another model call.
 await api(cookie,'ai-team',{method:'POST',data:{revision:current.revision,command:{action:'claim',job_id:job.id,claim_id}},request});
 seen.add(job.id+':'+(job.run_attempts||0));
 const controller=new AbortController();let timer,busy=false,heartbeatFailure=false,stage='model_failed';
 const report=async(action,extra={})=>{
  const latest=await api(cookie,'ai-team',{request});
  return api(cookie,'ai-team',{method:'POST',data:{revision:latest.revision,command:{action,job_id:job.id,claim_id,...extra}},request});
 };
 try{
  const task=await api(cookie,'ai-team/task?job_id='+encodeURIComponent(job.id)+'&claim_id='+claim_id,{request});validateTaskPacket(task);
  if(staffOnly)validateStaffAggregate(task);
  // Verify permission/lease immediately before inference, then periodically while the child runs.
  await report('heartbeat');
  timer=setInterval(async()=>{if(busy)return;busy=true;try{await report('heartbeat');}catch{heartbeatFailure=true;controller.abort();}finally{busy=false;}},heartbeatMs);
  onLog('依頼を受信しました: '+job.id.slice(0,8)+' — Claude Codeで分析します。');
  const {result,outputFile}=await run(task,{signal:controller.signal});
  clearInterval(timer);
  if(heartbeatFailure)throw Error('heartbeat_lost');
  const latest=await api(cookie,'ai-team',{request});const target=latest.state?.jobs?.find(x=>x.id===job.id);
  if(!latest.state?.enabled||!proactiveAllowed(latest,target)||target?.status!=='running'||target?.run?.claim_id!==claim_id||target?.input_hash!==task.input_hash){
   stage='stopped';throw Error('stopped');
  }
  stage='import_failed';
  await api(cookie,'ai-team',{method:'POST',data:{revision:latest.revision,command:{action:'import',job_id:task.job_id,claim_id,packet:result}},request});
  onLog('成果物を保存しました。管理アプリのAI社員画面で人間レビュー待ちです。');return {processed:true,imported:true};
 }catch{
  controller.abort();clearInterval(timer);
  // This also checks an uncertain import: completed imports must never be changed to failed.
  try{const latest=await api(cookie,'ai-team',{request});const target=latest.state?.jobs?.find(x=>x.id===job.id);
   if(['running','stopped'].includes(target?.status)&&target.run?.claim_id===claim_id)
    await api(cookie,'ai-team',{method:'POST',data:{revision:latest.revision,command:{action:'run_failed',job_id:job.id,claim_id,reason:target.status==='stopped'?'stopped':heartbeatFailure?'connection_lost':stage}},request});
   else if(target?.status==='in_review'&&target.run?.claim_id===claim_id)return {processed:true,imported:true};
  }catch{/* Offline state remains stale, never reported as current or retried automatically. */}
  return {processed:true,imported:false};
 }finally{clearInterval(timer);}
}
async function main(){
 const options=argumentsFor(process.argv.slice(2));
 requireTerminal();
 log('SICK STYLE AI社員ランナー（本人MacのClaude Code購読を使用）');
 log('対象: '+DEFAULT_ORIGIN);
 log('依頼は自動分析しますが、投稿・送信・価格変更・外部操作は行いません。');
 checkSubscription('claude'); // プロバイダーAPIキー等の代替課金を許可しない
 const email=(await ask('管理アプリの管理者メールアドレス: ')).trim().toLowerCase();
 if(!/^\S+@\S+\.\S+$/.test(email))fail('メールアドレスが正しくありません');
 let password=await secret('管理アプリのパスワード（非表示・保存しません）: ');
 const cookie=await signIn({email,password}); password='';
 log('自動実行対象は匿名の期限超過タスク集計だけです。自由入力・他データ種別は送信しません。');
 log('認証しました。依頼が登録されたら約'+options.interval/1000+'秒ごとに確認します。終了はCtrl+C。');
 const seen=new Set();
 while(true){
  try{await oneCycle(cookie,seen,{staffOnly:true,onLog:log});}
  catch(e){
   log('ランナー確認/実行失敗: '+e.message);
   if(/401|期限切れ/.test(e.message))break;
  }
  if(options.once)break;
  await wait(options.interval);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{process.stderr.write('ランナー停止: '+e.message+'\n');process.exitCode=1;});
