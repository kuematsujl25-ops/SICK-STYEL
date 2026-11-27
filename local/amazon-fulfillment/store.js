import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
// LOCAL synthetic data only. Never reads DATABASE_URL, .env, Cloudflare bindings, or production data.
export function openDemoStore(filename=':memory:'){
 if(filename!==':memory:'){mkdirSync(dirname(filename),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(filename);
 if(filename!==':memory:')chmodSync(filename,0o600);
 db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;
 CREATE TABLE IF NOT EXISTS demo_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT OR IGNORE INTO demo_meta VALUES('schema','2');
 INSERT OR IGNORE INTO demo_meta VALUES('revoked','false');
 INSERT OR IGNORE INTO demo_meta VALUES('erasure_generation','0');
 INSERT OR IGNORE INTO demo_meta VALUES('erasure_completed','0');
 CREATE TABLE IF NOT EXISTS demo_orders(id TEXT PRIMARY KEY,next_ref INTEGER NOT NULL DEFAULT 1,blocked INTEGER NOT NULL DEFAULT 0,observed_status TEXT,observed_at INTEGER);
 CREATE TABLE IF NOT EXISTS demo_packages(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES demo_orders(id),actor TEXT NOT NULL,reference INTEGER NOT NULL CHECK(reference>0),tracking_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PREVIEW','EXPIRED','QUEUED','SUBMITTING','UNKNOWN','ACCEPTED','VERIFIED','REJECTED','PURGED')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,payload TEXT,digest TEXT NOT NULL,UNIQUE(order_id,reference),UNIQUE(order_id,tracking_hash));
 CREATE TABLE IF NOT EXISTS demo_items(package_id TEXT NOT NULL REFERENCES demo_packages(id),item_id TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(package_id,item_id));
 CREATE TABLE IF NOT EXISTS demo_outbox(package_id TEXT PRIMARY KEY REFERENCES demo_packages(id),state TEXT NOT NULL CHECK(state IN ('QUEUED','IN_FLIGHT','UNKNOWN','ACCEPTED','VERIFIED','REJECTED','PURGED')),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts IN (0,1)),lease_until INTEGER,attempt_id TEXT,confirmed_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS demo_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_hash TEXT NOT NULL,event TEXT NOT NULL,package_id TEXT,at INTEGER NOT NULL);`);
 if(db.prepare("SELECT value FROM demo_meta WHERE key='schema'").get().value!=='2'){db.close();throw Error('UNSUPPORTED_DEMO_SCHEMA');}
 return {db,tx(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}},
 // Checkpoint old WAL frames after data removal. Storage snapshots/backups require a separate approved policy.
 compact(){
   // A reader can pin old WAL pages: a busy checkpoint is NOT proof of physical erasure.
   db.exec('PRAGMA busy_timeout=100');
   try{if(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy)return false;db.exec('VACUUM');return db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy===0;}
   catch(e){if(/busy|locked/i.test(e.message))return false;throw e;}
   finally{db.exec('PRAGMA busy_timeout=5000');}
  },close(){db.close();}};
}
