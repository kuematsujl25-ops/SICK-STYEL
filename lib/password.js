// パスワードハッシュ。WebCrypto PBKDF2-SHA256（Node / Cloudflare Workers 共通・ネイティブ実装）。
// 形式: "pbkdf2-sha256$<回数>$<hex>"。旧形式（区切りなしhex）は scrypt として検証します。
import {randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
// Workers の PBKDF2 上限は 100,000 回です。
export const ITERATIONS=100000;
async function pbkdf2(password,salt,iterations){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations},key,256);
 return Buffer.from(bits).toString('hex');
}
export async function hashPassword(password,iterations=ITERATIONS){
 const salt=randomBytes(32).toString('hex');
 return {salt,hash:`pbkdf2-sha256$${iterations}$${await pbkdf2(password,salt,iterations)}`};
}
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export async function verifyPassword(password,user){
 if(!user){await pbkdf2(password,'dummy-timing-salt',ITERATIONS);return false;}
 const parts=String(user.hash).split('$');
 if(parts[0]==='pbkdf2-sha256'&&parts.length===3){const n=Number(parts[1]);if(!Number.isInteger(n)||n<10000||n>ITERATIONS)return false;return same(await pbkdf2(password,user.salt,n),parts[2]);}
 return same((await scrypt(password,user.salt,64)).toString('hex'),String(user.hash));
}
