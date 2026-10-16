const schema = [
 'CREATE TABLE IF NOT EXISTS ss_users(id INTEGER PRIMARY KEY CHECK(id=1), email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ss_sessions(token TEXT PRIMARY KEY, expires BIGINT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ss_documents(name TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS ss_attempts(key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires BIGINT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ss_oauth(state TEXT PRIMARY KEY, session TEXT NOT NULL, expires BIGINT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS ss_events(mid TEXT PRIMARY KEY, peer TEXT NOT NULL, ts BIGINT NOT NULL, incoming INTEGER NOT NULL)',
];
export async function createStore(env=process.env){
 let query,transaction,close;
 if(env.DATABASE_URL){
  if(!env.DATABASE_URL.startsWith('postgres'))throw Error('DATABASE_URLにはPostgreSQL接続を指定してください');
  const {neon}=await import('@neondatabase/serverless');const sql=neon(env.DATABASE_URL);
  query=(text,values=[])=>sql.query(text,values);
  transaction=commands=>sql.transaction(commands.map(([text,values=[]])=>sql.query(text,values)));
  close=()=>{};
 }else{
  if(env.VERCEL||env.NODE_ENV==='production')throw Error('外部DATABASE_URLが未設定です。ローカル保存へは切り替えません。');
  const {DatabaseSync}=await import('node:sqlite');const {mkdirSync}=await import('node:fs');const path=await import('node:path');
  const dir=env.DATA_DIR||path.resolve('data');mkdirSync(dir,{recursive:true});const db=new DatabaseSync(path.join(dir,'sickstyle.sqlite'));db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
  query=(text,values=[])=>{const params=[];text=text.replace(/\$(\d+)/g,(_,n)=>{params.push(values[Number(n)-1]);return '?';});return db.prepare(text).all(...params);};
  transaction=async commands=>{db.exec('BEGIN IMMEDIATE');try{const result=[];for(const [text,values]of commands)result.push(query(text,values));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  close=()=>db.close();
  for(const s of schema)db.exec(s);
  // Keep the original SQLite tables intact and migrate their contents once.
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()){
   db.exec("INSERT OR IGNORE INTO ss_users SELECT 1,email,hash,salt FROM users ORDER BY id LIMIT 1; INSERT OR IGNORE INTO ss_documents(name,body) SELECT name,body FROM documents;");
  }
 }
 await transaction(schema.map(s=>[s]));
 return {query,transaction,close,kind:env.DATABASE_URL?'postgres':'sqlite',async doc(name){return (await query('SELECT body,revision FROM ss_documents WHERE name=$1',[name]))[0];},async put(name,data){return query('INSERT INTO ss_documents(name,body) VALUES ($1,$2) ON CONFLICT(name) DO UPDATE SET body=excluded.body,revision=ss_documents.revision+1 RETURNING revision',[name,JSON.stringify(data)]);}};
}
let pending;
export function getStore(){return pending??=createStore().catch(e=>{pending=undefined;throw e;});}
