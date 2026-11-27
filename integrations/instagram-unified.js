// Owner-only, read-only Business Integration System User flow.
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
export const unifiedScopes=Object.freeze(['instagram_basic','instagram_manage_insights']);
const optionalScopes=['public_profile']; // Meta supplies this by default; it is not requested here.
const id=v=>typeof v==='string'&&/^\d{5,30}$/.test(v);
const accountIdOf=v=>typeof v==='number'&&Number.isSafeInteger(v)?String(v):v;
export const normalizeInstagramHandle=v=>typeof v==='string'?v.trim().replace(/^@/,'').toLowerCase():'';
const name=v=>typeof v==='string'&&/^[a-z0-9_.]{1,30}$/.test(v);
const graphBase='https://graph.facebook.com/v27.0';
const sixtyDays=60*86400000;

// Only fixed diagnostic labels and bounded numeric Meta codes may leave the callback.
const callbackSteps=new Set(['state_mode','state_session','meta_declined','missing_code','code_exchange','token_debug','token_identity','token_scope','token_expiry','portfolio_lookup','portfolio_policy','account_lookup','account_policy','account_missing','account_multiple','account_identity','account_profile_lookup','account_profile_identity','account_paging','account_shape','connection_conflict','save_connection']);
export class InstagramCallbackError extends Error{
 constructor(step,message,source){
  super(message);
  this.step=callbackSteps.has(step)?step:'unexpected';
  this.metaCode=Number.isSafeInteger(source?.code)&&source.code>=1&&source.code<=999999?source.code:null;
 }
}
export function instagramCallbackDiagnostic(error){
 return error instanceof InstagramCallbackError?{step:error.step,metaCode:error.metaCode}:{step:'unexpected',metaCode:null};
}
export const atCallbackStep=async(step,run)=>{
 try{return await run();}
 catch(e){throw new InstagramCallbackError(step,'Instagramの認可を完了できませんでした。',e);}
};


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
// Verify exactly one distinct Instagram account in the complete assigned set.
// Use only Meta's cursor as an opaque value with a pinned Graph origin and path.
// Never follow the paging.next URL, which can contain credentials or another host.
async function verifyAssignedAccount(read,expectedUsername){
 let after;const seen=new Set(),accounts=new Map();
 for(let page=0;page<4;page++){
  const assigned=await atCallbackStep('account_lookup',()=>read('me/assigned_instagram_accounts',{fields:'id,username',limit:'2',...(after?{after}:{})}));
  if(!Array.isArray(assigned?.data))throw new InstagramCallbackError('account_shape','Metaの共有アカウント一覧の形式を確認できません');
  for(const row of assigned.data){
   // Meta documents string IDs. A number is verifiable only if exactly representable.
   const accountId=accountIdOf(row?.id);
   if(!id(accountId))throw new InstagramCallbackError('account_shape','Metaの共有アカウントIDを確認できません');
   const username=normalizeInstagramHandle(row.username);
   if(row.username!=null&&typeof row.username!=='string')throw new InstagramCallbackError('account_shape','共有アカウント名の形式を確認できません');
   const known=accounts.get(accountId);
   if(known&&username&&known!==username)throw new InstagramCallbackError('account_identity','Metaから返された共有アカウント名が一致しません');
   accounts.set(accountId,username||known||'');
   if(accounts.size>1)throw new InstagramCallbackError('account_multiple','複数のInstagramアカウントが共有されています');
  }
  if(!assigned.paging?.next){
   if(!accounts.size)throw new InstagramCallbackError('account_missing','Metaから共有済みInstagramアカウントが返りませんでした');
   const [accountId,username]=accounts.entries().next().value;
   if(username&&username!==expectedUsername)throw new InstagramCallbackError('account_identity','Metaから返された共有アカウント名が設定と一致しません');
   // The assignment is authoritative for membership. If its row omits the
   // handle, check only that exact account's profile using the same token.
   // Never substitute a different account or bypass a known mismatch.
   if(!username){
    const profile=await atCallbackStep('account_profile_lookup',()=>read(accountId,{fields:'id,username'}));
    if(accountIdOf(profile?.id)!==accountId||normalizeInstagramHandle(profile?.username)!==expectedUsername)
     throw new InstagramCallbackError('account_profile_identity','共有アカウントのプロフィールを照合できません');
   }
   return {id:accountId,username:expectedUsername};
  }
  const cursor=assigned.paging?.cursors?.after;
  if(typeof cursor!=='string'||!/^[A-Za-z0-9_+=/.-]{1,512}$/.test(cursor)||seen.has(cursor))
   throw new InstagramCallbackError('account_paging','共有アカウント一覧の続きを安全に確認できません');
  seen.add(cursor);after=cursor;
 }
 throw new InstagramCallbackError('account_paging','共有アカウント一覧の続きを安全に確認できません');
}
export async function exchangeUnified(settings,code,remote,now=Date.now()){
 const exchange=new URL(`${graphBase}/oauth/access_token`);
 exchange.search=new URLSearchParams({client_id:settings.appId,client_secret:settings.secret,code,redirect_uri:settings.redirect});
 const grant=await atCallbackStep('code_exchange',()=>remote(exchange,{method:'GET',cache:'no-store'}));
 if(typeof grant.access_token!=='string'||!grant.access_token)throw new InstagramCallbackError('code_exchange','認可トークンを取得できませんでした');
 const access=grant.access_token;
 const debugURL=new URL(`${graphBase}/debug_token`);
 debugURL.searchParams.set('input_token',access);
 const {data}=await atCallbackStep('token_debug',()=>remote(debugURL,{method:'GET',headers:{Authorization:`Bearer ${settings.appId}|${settings.secret}`},cache:'no-store'}));
 const actual=Array.isArray(data?.scopes)?data.scopes:[];
 const tokenExpires=Number(data?.expires_at)*1000;
 const dataExpiry=data?.data_access_expires_at==null?0:Number(data.data_access_expires_at)*1000;
 const expiresAt=dataExpiry>0?Math.min(tokenExpires,dataExpiry):tokenExpires;
 if(data?.is_valid!==true||String(data.app_id)!==settings.appId)throw new InstagramCallbackError('token_identity','対象のアプリに発行された有効な認可を確認できません');
 if(!unifiedScopes.every(s=>actual.includes(s))||actual.some(s=>!unifiedScopes.includes(s)&&!optionalScopes.includes(s)))throw new InstagramCallbackError('token_scope','承認された読み取り権限を確認できません');
 if(!Number.isSafeInteger(tokenExpires)||tokenExpires>now+sixtyDays+60000||!Number.isSafeInteger(dataExpiry)||dataExpiry<0||expiresAt<=now)throw new InstagramCallbackError('token_expiry','60日以内の有効期限を確認できません');
 const read=(path,params)=>unifiedGraph(path,access,params,remote);
 const business=await atCallbackStep('portfolio_lookup',()=>read('me',{fields:'client_business_id'}));
 if(business.client_business_id!==settings.businessId)throw new InstagramCallbackError('portfolio_policy','許可されたビジネスポートフォリオと一致しません');
 const account=await verifyAssignedAccount(read,settings.username);
 return {access,id:account.id,username:account.username,granted:[...unifiedScopes],expiresAt,businessId:settings.businessId,configId:settings.configId};
}
