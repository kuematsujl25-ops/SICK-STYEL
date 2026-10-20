// Private local evidence only. No network, no credentials, no raw data in errors or console output.
import {mkdirSync,lstatSync,realpathSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {bytesHash} from './utf8-capture.js';
import {TeamError} from '../../lib/ai-team.js';
const fail=()=>{throw new TeamError('私有実行証拠の保存・照合を確認できません。成果物は取り込みません');};
export function evidenceRoot(){return join(homedir(),'Library/Application Support/SICKSTYLE/private-runs');}
export function prepareEvidenceRoot(){
  if(process.platform!=='darwin')fail();
  const support=join(homedir(),'Library/Application Support');
  for(let p=support;;p=dirname(p)){if(lstatSync(p).isSymbolicLink()||!lstatSync(p).isDirectory())fail();if(dirname(p)===p)break;}
  for(const p of [join(support,'SICKSTYLE'),evidenceRoot()]){
    if(!existsSync(p))mkdirSync(p,{mode:0o700});
    checkDirectory(p);
  }
  return evidenceRoot();
}
function checkDirectory(path){const s=lstatSync(path);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||(process.getuid&&s.uid!==process.getuid()))fail();}
const safeName=n=>typeof n==='string'&&/^[a-z][a-z0-9_.-]{0,79}$/.test(n)&&!n.includes('..');
export function createEvidenceDirectory(root){checkDirectory(root);const dir=join(realpathSync(root),randomUUID());mkdirSync(dir,{mode:0o700});return dir;}
export function saveEvidence(dir,files,metadata){
  checkDirectory(dir);const entries={};
  for(const [name,value] of Object.entries(files)){
    if(!safeName(name)||name==='evidence.json')fail();
    const bytes=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');
    if(bytes.length>4_000_000)fail();
    writeFileSync(join(dir,name),bytes,{mode:0o600,flag:'wx'});
    entries[name]={bytes:bytes.length,raw_bytes_sha256:bytesHash(bytes)};
  }
  const manifest={version:1,kind:'sickstyle-private-run-evidence',metadata,files:entries};
  const raw=JSON.stringify(manifest,null,2)+'\n';
  writeFileSync(join(dir,'evidence.json'),raw,{mode:0o600,flag:'wx'});
  return {directory:dir,manifest_sha256:bytesHash(Buffer.from(raw)),raw_transcript_persisted:true};
}
export function readEvidence(dir,expectedHash){
  checkDirectory(dir);
  const read=(name,max=4_000_000)=>{
    if(!safeName(name))fail();
    const path=join(dir,name),s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||(s.mode&0o077)||s.size>max||(process.getuid&&s.uid!==process.getuid()))fail();
    return readFileSync(path);
  };
  const raw=read('evidence.json',262144);
  if(!/^[a-f0-9]{64}$/.test(expectedHash)||bytesHash(raw)!==expectedHash)fail();
  let manifest;try{manifest=JSON.parse(raw)}catch{fail()}
  if(manifest.version!==1||manifest.kind!=='sickstyle-private-run-evidence'||!manifest.files||typeof manifest.files!=='object')fail();
  const files={};
  for(const [name,entry] of Object.entries(manifest.files)){
    const bytes=read(name);if(bytes.length!==entry.bytes||bytesHash(bytes)!==entry.raw_bytes_sha256)fail();files[name]=bytes;
  }
  return {manifest,files};
}
