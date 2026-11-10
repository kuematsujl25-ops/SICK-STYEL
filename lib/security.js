import {runtime} from './runtime.js';
import {randomBytes,createHash,createCipheriv,createDecipheriv,timingSafeEqual,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
export const scrypt=promisify(scryptCallback);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('hex');
export function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
function key(){const b=Buffer.from(runtime().TOKEN_ENCRYPTION_KEY||'','base64');if(b.length!==32)throw Error('TOKEN_ENCRYPTION_KEY（32バイトbase64）が必要です');return b;}
export function encrypt(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv);const b=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return [iv,c.getAuthTag(),b].map(x=>x.toString('base64url')).join('.');}
export function decrypt(value){const [iv,tag,b]=value.split('.').map(x=>Buffer.from(x,'base64url'));const c=createDecipheriv('aes-256-gcm',key(),iv);c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(b),c.final()]).toString());}
