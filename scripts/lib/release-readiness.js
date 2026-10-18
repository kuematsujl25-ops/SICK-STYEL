import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

export const fileHash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function reviewForHead(root,head,base) {
  const directory=resolve(root,'data/code-reviews');
  let names;
  try{names=readdirSync(directory);}catch{throw Error('最新SHAの独立Codexレビューがありません');}
  const matches=names.filter(name=>name.startsWith(head+'-')&&name.endsWith('.json'))
    .map(name=>{const path=resolve(directory,name);try{return {...JSON.parse(readFileSync(path,'utf8')),path};}catch{throw Error('独立レビューのJSON形式を確認してください');}})
    .filter(r=>r.head===head&&r.base===base&&r.base!==r.head&&r.provider==='codex'&&r.status==='human_assessment_required'&&
      typeof r.report==='string'&&r.report.trim()&&Number.isFinite(Date.parse(r.finished_at))&&Date.parse(r.finished_at)<=Date.now()+300000)
    .sort((a,b)=>Date.parse(b.finished_at)-Date.parse(a.finished_at));
  const review=matches[0];
  if(!review)throw Error('最新SHAの独立Codexレビューがありません。npm run ai:review を実行してください');
  if(/\bP[012]\b/i.test(review.report))throw Error('最新レビューにP0/P1/P2の記載があります。未解決の指摘を確認・修正して再レビューしてください');
  return {file:relative(root,review.path),sha256:fileHash(review.path),base};
}
export function productionVersions(value) {
  const versions=value?.versions;
  if(!Array.isArray(versions)||!versions.length||versions.length>10||versions.some(v=>
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.version_id)||typeof v.percentage!=='number'||!Number.isFinite(v.percentage)||v.percentage<0||v.percentage>100)||
    new Set(versions.map(v=>v.version_id)).size!==versions.length||
    Math.abs(versions.reduce((n,v)=>n+v.percentage,0)-100)>0.001)
    throw Error('本番Versionと配分を確認できません。反映を停止します');
  return versions.map(({version_id,percentage})=>({version_id,percentage})).sort((a,b)=>a.version_id.localeCompare(b.version_id));
}
export function verifySqlBackup(path) {
  const sql=readFileSync(path,'utf8');
  if(!sql.trim()||Buffer.byteLength(sql)>128000000)throw Error('バックアップのサイズを確認してください');
  const dir=mkdtempSync(join(tmpdir(),'sickstyle-restore-'));let db;
  try {
    db=new DatabaseSync(join(dir,'restore.sqlite'));db.exec(sql);
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('integrity');
    for(const table of ['ss_users','ss_sessions','ss_documents','ss_attempts','ss_oauth','ss_events'])
      if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))throw Error('schema');
    if(!db.prepare('SELECT COUNT(*) AS n FROM ss_users').get().n)throw Error('admin');
    return {sha256:fileHash(path),local_restore_verified:true};
  } catch { throw Error('SQLバックアップのローカル復元・完全性を確認できません。反映を停止します'); }
  finally { db?.close();rmSync(dir,{recursive:true,force:true}); }
}
export function checkReadiness(root,head,config,receipt,base,now=Date.now()) {
  if(receipt?.version!==1||receipt.head!==head||receipt.worker!==config.name||receipt.account_id!==config.account_id||
    receipt.database_id!==config.d1_databases[0].database_id||
    !Number.isFinite(Date.parse(receipt.checked_at))||Date.parse(receipt.checked_at)>now||now-Date.parse(receipt.checked_at)>3600000||
    !['free_and_zero_cost_confirmed','settings_preservation_confirmed','rollback_compatibility_confirmed','review_confirmed','validation_confirmed']
      .every(key=>receipt[key]===true))throw Error('最新SHAの事前確認が不足・期限切れです。npm run deploy:preflight が必要です');
  productionVersions({versions:receipt.previous_versions});
  for(const item of [receipt.review,receipt.backup]) {
    if(typeof item?.file!=='string')throw Error('事前確認ファイルが不足しています');
    const path=resolve(root,item.file),rel=relative(resolve(root,'data'),path);
    if(rel==='..'||rel.startsWith('../')||isAbsolute(rel)||fileHash(path)!==item.sha256)
      throw Error('事前確認ファイルが変更されたか、保存先が不正です');
  }
  const review=reviewForHead(root,head,base);
  if(review.file!==receipt.review.file||review.sha256!==receipt.review.sha256)throw Error('レビューが更新されています。事前確認をやり直してください');
  const restored=verifySqlBackup(resolve(root,receipt.backup.file));
  if(restored.sha256!==receipt.backup.sha256||receipt.backup.local_restore_verified!==true)
    throw Error('バックアップの復元確認が必要です');
}
