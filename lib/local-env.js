import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
export function loadLocalEnv(root,env=process.env){
 if(env.NODE_ENV==='production'||env.VERCEL||env.DATA_DIR)return {loaded:false,setupReady:!!env.SETUP_TOKEN};
 // Shell values take precedence. .env.local overrides .env. Never load downloaded Vercel placeholders.
 const values={};for(const name of ['.env','.env.local']){const file=path.join(root,name);if(existsSync(file))Object.assign(values,parseEnv(readFileSync(file,'utf8')));}
 for(const [k,v]of Object.entries(values))if(!env[k]&&v&&v!=='[SENSITIVE]')env[k]=v;
 const file=path.join(root,'.env.bootstrap');if(existsSync(file)){const secret=JSON.parse(readFileSync(file,'utf8'));for(const k of ['SETUP_TOKEN','TOKEN_ENCRYPTION_KEY','CRON_SECRET','META_WEBHOOK_VERIFY_TOKEN'])if(!env[k]&&secret[k])env[k]=secret[k];}
 return {loaded:true,setupReady:!!env.SETUP_TOKEN};
}
