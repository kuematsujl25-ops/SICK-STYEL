throw new Error('Vercel公開は廃止しました。Cloudflare用の無料公開手順を使用してください。');
// Creates secrets once locally; pipes values to the verified linked Vercel project without printing them.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const link=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(link.projectId!=='prj_YjVpTp0RmJJIVblZAYVJI9CltfJx'||link.orgId!=='team_GgtHBbucE447pBj3K56h5gsk')throw Error('公開先が想定と異なります');
const file='.env.bootstrap';let config;
if(existsSync(file))config=JSON.parse(readFileSync(file,'utf8'));else{config={TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),SETUP_TOKEN:randomBytes(32).toString('base64url'),CRON_SECRET:randomBytes(32).toString('base64url'),META_WEBHOOK_VERIFY_TOKEN:randomBytes(32).toString('base64url')};writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});}
if(process.argv.includes('--apply')){
 for(const [name,value]of Object.entries(config)){
  const r=spawnSync('vercel',['env','add',name,'production','--sensitive','--yes','--non-interactive','--scope','kuematsujl25-3805','--project',link.projectId],{input:value,encoding:'utf8'});
  if(r.status!==0){console.error('環境変数の追加に失敗: '+name);console.error(r.stderr.replaceAll(value,'[REDACTED]'));process.exit(1);}console.log('設定済み: '+name);
 }
}else console.log('秘密値を.env.bootstrap（所有者のみ読取可能）に生成しました。--applyを付けるとProductionへ追加します。値は出力しません。');
