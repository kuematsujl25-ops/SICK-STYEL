import {existsSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const file='.env.bootstrap';const values=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
for(const name of ['SETUP_TOKEN','CRON_SECRET','META_WEBHOOK_VERIFY_TOKEN'])if(!values[name])values[name]=randomBytes(32).toString('base64url');
if(!values.TOKEN_ENCRYPTION_KEY)values.TOKEN_ENCRYPTION_KEY=randomBytes(32).toString('base64');
writeFileSync(file,JSON.stringify(values,null,2)+'\n',{mode:0o600});chmodSync(file,0o600);
if(!existsSync('.dev.vars')){writeFileSync('.dev.vars',Object.entries(values).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\nCF_LOCAL_DEV="true"\nCOOKIE_SECURE="false"\n',{mode:0o600,flag:'wx'});}
console.log('SETUP_TOKENほかのローカル秘密設定を準備しました。値は非表示です。');
console.log('npm startで自動読込します。キー入力を省いて管理者を安全に作るにはnpm run admin:createを実行してください。');
