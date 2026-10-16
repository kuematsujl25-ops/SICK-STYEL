import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createStore} from '../lib/store.js';
import {validate} from '../lib/domain.js';
const source=process.env.LEGACY_SQLITE||path.resolve('data/sickstyle.sqlite');
const old=new DatabaseSync(source,{readOnly:true});
const userTable=old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ss_users'").get()?'ss_users':'users';
const docsTable=userTable==='ss_users'?'ss_documents':'documents';
const users=old.prepare(`SELECT email,hash,salt FROM ${userTable} LIMIT 2`).all();
const docs=old.prepare(`SELECT name,body FROM ${docsTable} WHERE name IN ('workspace','before-restore')`).all();
if(users.length>1)throw Error('複数管理者の移行方針を確認してください');
for(const d of docs)validate(JSON.parse(d.body));
console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'dry-run',users:users.length,documents:docs.map(d=>d.name),sessions:'not migrated'}));
if(process.argv.includes('--apply')){
 if(!process.env.DATABASE_URL)throw Error('移行先の外部DATABASE_URLが必要です');
 mkdirSync('data/backups',{recursive:true});const backup=path.resolve('data/backups',`migration-${Date.now()}.sqlite`);old.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
 const store=await createStore();const counts=await store.query('SELECT (SELECT COUNT(*) FROM ss_users) AS users,(SELECT COUNT(*) FROM ss_documents WHERE name=$1) AS docs',['workspace']);
 if(Number(counts[0].users)||Number(counts[0].docs))throw Error('移行先に既存データがあるため中止しました。上書きは行いません');
 const commands=[];if(users[0])commands.push(['INSERT INTO ss_users(id,email,hash,salt) VALUES(1,$1,$2,$3)',[users[0].email,users[0].hash,users[0].salt]]);
 for(const d of docs)commands.push(['INSERT INTO ss_documents(name,body,revision) VALUES($1,$2,0)',[d.name,JSON.stringify(validate(JSON.parse(d.body)))]]);
 if(commands.length)await store.transaction(commands);
 for(const d of docs){const r=await store.doc(d.name);if(JSON.stringify(validate(JSON.parse(r.body)))!==JSON.stringify(validate(JSON.parse(d.body))))throw Error('移行後の照合に失敗しました');}
 console.log('バックアップ・移行・照合が完了しました。元のSQLiteは変更していません。');store.close();
}
old.close();
