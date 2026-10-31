// Minimal RFC 8291 (aes128gcm) + RFC 8292 VAPID sender, using WebCrypto only.
// Runs on Cloudflare Workers without a Node-specific web-push dependency.
const utf8=s=>new TextEncoder().encode(s);
const join=(...parts)=>{const all=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){all.set(p,offset);offset+=p.length;}return all;};
export function unbase64url(s){if(typeof s!=='string'||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('Invalid base64url');const padded=s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4);return Uint8Array.from(atob(padded),c=>c.charCodeAt(0));}
export const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function derive(input,salt,info,length){
 const key=await crypto.subtle.importKey('raw',input,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8));
}
const validEndpoint=input=>{
 const u=new URL(input);
 const host=u.hostname.toLowerCase();
 const approved=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
 if(u.protocol!=='https:'||!approved||u.username||u.password||u.port||u.hash||u.href.length>2100)throw Error('未承認のPush配信先です');
 return u.href;
};
export function validateSubscription(sub){
 if(!sub||typeof sub!=='object'||!sub.keys)throw Error('Push購読情報が不正です');
 const endpoint=validEndpoint(sub.endpoint);
 const p256dh=unbase64url(sub.keys.p256dh),auth=unbase64url(sub.keys.auth);
 if(p256dh.length!==65||p256dh[0]!==4||auth.length!==16)throw Error('Push暗号化鍵が不正です');
 return {endpoint,expirationTime:null,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
}
function vapidPublic(s){const pub=unbase64url(s);if(pub.length!==65||pub[0]!==4)throw Error('VAPID公開鍵が不正です');return pub;}
export async function pushRequest(subscription,env,payload){
 const sub=validateSubscription(subscription);
 const publicVapid=vapidPublic(env.VAPID_PUBLIC_KEY);
 const priv=unbase64url(env.VAPID_PRIVATE_KEY||'');
 if(priv.length!==32)throw Error('VAPID秘密鍵が未設定です');
 const subject=env.VAPID_SUBJECT||env.APP_ORIGIN;
 if(!/^mailto:.+@.+$/.test(subject)&&!/^https:\/\/[^ ]+$/.test(subject))throw Error('VAPID連絡先を確認してください');
 const x=base64url(publicVapid.slice(1,33)),y=base64url(publicVapid.slice(33));
 const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x,y,d:base64url(priv)},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const now=Math.floor(Date.now()/1000);
 const head=base64url(utf8(JSON.stringify({typ:'JWT',alg:'ES256'}))),claims=base64url(utf8(JSON.stringify({aud:new URL(sub.endpoint).origin,exp:now+3600,sub:subject})));
 const sign=base64url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8(head+'.'+claims))));
 const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const peer=await crypto.subtle.importKey('raw',unbase64url(sub.keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},ephemeral.privateKey,256));
 const ephemeralPub=new Uint8Array(await crypto.subtle.exportKey('raw',ephemeral.publicKey));
 const auth=unbase64url(sub.keys.auth),recipient=unbase64url(sub.keys.p256dh);
 const ikm=await derive(shared,auth,join(utf8('WebPush: info'),new Uint8Array([0]),recipient,ephemeralPub),32);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await derive(ikm,salt,join(utf8('Content-Encoding: aes128gcm'),new Uint8Array([0])),16);
 const nonce=await derive(ikm,salt,join(utf8('Content-Encoding: nonce'),new Uint8Array([0])),12);
 const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const body=join(utf8(JSON.stringify(payload)),new Uint8Array([2]));if(body.length>3800)throw Error('Pushメッセージが長すぎます');
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aes,body));
 const rs=new Uint8Array([0,0,16,0,65]);
 const record=join(salt,rs,ephemeralPub,ciphertext);
 return {endpoint:sub.endpoint,init:{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Encoding':'aes128gcm','Authorization':'vapid t='+head+'.'+claims+'.'+sign+', k='+env.VAPID_PUBLIC_KEY,'TTL':String(payload.expiresAt?Math.max(0,Math.min(600,Math.floor((payload.expiresAt-Date.now())/1000))):3600)},body:record,signal:AbortSignal.timeout(10000)}};
}
