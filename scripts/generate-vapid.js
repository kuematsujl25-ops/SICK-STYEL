// 端末上だけでVAPID鍵を作成する補助。Cloudflareや課金設定を変更しない。
import {generateKeyPairSync} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
if(process.argv.length!==2)throw Error('使い方: node scripts/generate-vapid.js');
process.umask(0o077);
const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=privateKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
const path=resolve('.wrangler/vapid-credentials.json');
mkdirSync('.wrangler',{recursive:true,mode:0o700});
writeFileSync(path,JSON.stringify({VAPID_PUBLIC_KEY:publicKey,VAPID_PRIVATE_KEY:jwk.d,VAPID_SUBJECT:'https://sickstyle-manager.sickstyle-74h4.workers.dev'},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('VAPID鍵をMac内に生成しました（内容は表示していません）。秘密の保管先: '+path);
console.log('Cloudflare Secretsの変更・通知送信は行っていません。公開鍵と秘密鍵を本人が安全に登録してください。');
