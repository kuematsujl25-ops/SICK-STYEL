import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {checkSubscription,codexArgs} from './cli.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const git = args => {
  const r = spawnSync('git',args,{cwd:root,encoding:'utf8'});
  if (r.status !== 0) throw Error('Gitの状態を確認してください');
  return r.stdout.trim();
};
try {
  const args = process.argv.slice(2);
  const base = args[args.indexOf('--base')+1];
  if (!args.includes('--base') || !base || base.startsWith('-')) throw Error('--base に比較元ブランチまたはSHAを指定してください');
  if (git(['status','--porcelain'])) throw Error('変更をコミットしてから独立レビューしてください');
  const head = git(['rev-parse','HEAD']);
  const baseSha = git(['rev-parse','--verify',base+'^{commit}']);
  const env = checkSubscription('codex');
  const dir = mkdtempSync(resolve(tmpdir(),'sickstyle-review-'));
  try {
    const output = resolve(dir,'review.txt');
    const started_at = new Date().toISOString();
    const result = spawnSync('codex',codexArgs({output,reviewBase:baseSha}),
      {cwd:root,env,encoding:'utf8',timeout:600000,maxBuffer:4_000_000});
    if (result.status !== 0) throw Error('Codexレビュー未完了です。本人端末で認証・契約上限を確認してください');
    if (git(['rev-parse','HEAD']) !== head || git(['status','--porcelain']))
      throw Error('レビュー中にコードが変更されました。再レビューが必要です');
    const report = readFileSync(output,'utf8');
    if (!report.trim()) throw Error('レビューの出力がありません。合格として扱いません');
    mkdirSync(resolve(root,'data/code-reviews'),{recursive:true,mode:0o700});
    const path = resolve(root,'data/code-reviews',head+'-'+randomUUID()+'.json');
    writeFileSync(path,JSON.stringify({head,base:baseSha,provider:'codex',started_at,
      finished_at:new Date().toISOString(),status:'human_assessment_required',report},null,2)+'\n',
      {mode:0o600,flag:'wx'});
    console.log(`Codexレビューを保存しました。指摘と対象SHAを人間が確認してください。\n${path}`);
  } finally { rmSync(dir,{recursive:true,force:true}); }
} catch (error) { console.error(error.code ? 'CLI・ファイルの状態を確認してください' : error.message); process.exitCode=1; }
