// Owner-only, read-only Business Integration System User flow.
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
export const unifiedScopes=Object.freeze(['instagram_basic','instagram_manage_insights']);
const optionalScopes=['public_profile']; // Meta supplies this by default; it is not requested here.
const id=v=>typeof v==='string'&&/^\d{5,30}$/.test(v);
const name=v=>typeof v==='string'&&/^[a-z0-9_.]{1,30}$/.test(v);
const graphBase='https://graph.facebook.com/v27.0';
const sixtyDays=60*86400000;

export function unifiedSettings(env){
 const {INSTAGRAM_UNIFIED_APP_ID:appId,INSTAGRAM_UNIFIED_APP_SECRET:secret,INSTAGRAM_UNIFIED_CONFIG_ID:configId,INSTAGRAM_UNIFIED_BUSINESS_ID:businessId,INSTAGRAM_UNIFIED_USERNAME:username,APP_ORIGIN:origin}=env;
 if(!id(appId)||!id(configId)||!id(businessId)||!name(username)||typeof secret!=='string'||!secret||!env.TOKEN_ENCRYPTION_KEY)return null;
 try{
  const u=new URL(origin);
  if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password)return null;
  return {appId,secret,configId,businessId,username,redirect:new URL('/api/instagram/callback',u).href};
 }catch{return null;}
}
export function unifiedLogin(settings,state){
 const u=new URL('https://www.facebook.com/dialog/oauth');
 u.search=new URLSearchParams({client_id:settings.appId,config_id:settings.configId,redirect_uri:settings.redirect,response_type:'code',prompt:'login',state});
 return u.href;
}
export function unifiedGraph(path,access,params,remote){
 if(!/^(?:me(?:\/assigned_instagram_accounts)?|\d+(?:\/(?:media|insights))?)$/.test(path))throw Error('Instagram読み取り対象が不正です');
 const u=new URL(`${graphBase}/${path}`);
 for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 return remote(u,{method:'GET',headers:{Authorization:`Bearer ${access}`}});
}
export async function exchangeUnified(settings,code,remote,now=Date.now()){
 const exchange=new URL(`${graphBase}/oauth/access_token`);
 exchange.search=new URLSearchParams({client_id:settings.appId,client_secret:settings.secret,code,redirect_uri:settings.redirect});
 const grant=await remote(exchange,{method:'GET',redirect:'error',cache:'no-store'});
 if(typeof grant.access_token!=='string'||!grant.access_token)throw Error('認可トークンを取得できませんでした');
 const access=grant.access_token;
 const debugURL=new URL(`${graphBase}/debug_token`);
 debugURL.searchParams.set('input_token',access);
 const {data}=await remote(debugURL,{method:'GET',headers:{Authorization:`Bearer ${settings.appId}|${settings.secret}`},redirect:'error',cache:'no-store'});
 const actual=Array.isArray(data?.scopes)?data.scopes:[];
 const expiresAt=Number(data?.expires_at)*1000;
 if(data?.is_valid!==true||String(data.app_id)!==settings.appId||!unifiedScopes.every(s=>actual.includes(s))||
    actual.some(s=>!unifiedScopes.includes(s)&&!optionalScopes.includes(s))||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+sixtyDays+60000){
   throw Error('承認された読み取り権限・アプリ・60日以内の期限を確認できません');
 }
 const read=(path,params)=>unifiedGraph(path,access,params,remote);
 const business=await read('me',{fields:'client_business_id'});
 if(business.client_business_id!==settings.businessId)throw Error('許可されたビジネスポートフォリオと一致しません');
 const assigned=await read('me/assigned_instagram_accounts',{fields:'id,username',limit:'2'});
 const account=assigned?.data?.[0];
 if(!Array.isArray(assigned?.data)||assigned.data.length!==1||assigned.paging?.next||!id(account?.id)||account.username?.toLowerCase()!==settings.username){
  throw Error('許可されたInstagramアカウント1件だけを選択してください');
 }
 return {access,id:account.id,username:account.username,granted:[...unifiedScopes],expiresAt,businessId:settings.businessId,configId:settings.configId};
}
