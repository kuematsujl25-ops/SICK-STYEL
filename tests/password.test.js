import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,ITERATIONS} from '../lib/password.js';
import {scrypt} from '../lib/security.js';
test('PBKDF2ハッシュ: 正しいパスワードのみ通過・平文を含まない・旧scrypt形式も検証',async()=>{
 const pw='Correct-horse-2026';const u=await hashPassword(pw);
 assert.match(u.hash,new RegExp('^pbkdf2-sha256\\$'+ITERATIONS+'\\$[0-9a-f]{64}$'));assert.equal(u.hash.includes(pw),false);
 assert.equal(await verifyPassword(pw,u),true);assert.equal(await verifyPassword('wrong-password-xx',u),false);assert.equal(await verifyPassword(pw,null),false);
 assert.equal(await verifyPassword(pw,{...u,hash:'pbkdf2-sha256$1$'+u.hash.split('$')[2]}),false);
 const salt='legacy-salt';const legacy={salt,hash:(await scrypt(pw,salt,64)).toString('hex')};assert.equal(await verifyPassword(pw,legacy),true);assert.equal(await verifyPassword('nope-nope-nope',legacy),false);
});
