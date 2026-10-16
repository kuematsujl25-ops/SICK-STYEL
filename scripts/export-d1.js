// Exports only owner/workspace records to a private SQL file. Never prints data, hashes or keys.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {validate} from '../lib/domain.js';
const source=process.env.LEGACY_SQLITE||resolve('data/sickstyle.sqlite');const db=new DatabaseSync(source,{readOnly:true});
const prefix=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ss_users'").get()?'ss_':'';
const users=db.prepare(`SELECT email,hash,salt FROM ${prefix}users LIMIT 2`).all();if(users.length>1)throw Error('管理者が複数いるため移行を停止しました');
const docs=db.prepare(`SELECT name,body FROM ${prefix}documents WHERE name IN ('workspace','before-restore')`).all();
for(const d of docs){d.body=JSON.stringify(validate(JSON.parse(d.body)));if(Buffer.byteLength(d.body)>1900000)throw Error('D1の1行上限に近いため移行方針を確認してください');}
mkdirSync('.migration',{recursive:true,mode:0o700});mkdirSync('data/backups',{recursive:true});
const backup=resolve('data/backups',`d1-migration-${Date.now()}.sqlite`);db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);db.close();
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
// No ON CONFLICT update: existing remote data always prevents an import from overwriting it.
const sql=[];if(users[0])sql.push(`INSERT INTO ss_users(id,email,hash,salt) VALUES(1,${quote(users[0].email)},${quote(users[0].hash)},${quote(users[0].salt)});`);
for(const d of docs)sql.push(`INSERT INTO ss_documents(name,body,revision) VALUES(${quote(d.name)},${quote(d.body)},0);`);
writeFileSync('.migration/legacy.sql',sql.join('\n')+'\n',{mode:0o600});
const manifest={users:users.length,documents:docs.map(d=>({name:d.name,sha256:createHash('sha256').update(d.body).digest('hex')})),sourceProtected:true,sessionsMigrated:false};writeFileSync('.migration/manifest.json',JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({users:users.length,documents:docs.length,exported:'.migration/legacy.sql',sourceProtected:true}));
