// Produces public metadata only. Never loads credential values or calls a service.
export function registrationPlan(config,target){
 const requirements={instagram:['INSTAGRAM_APP_ID','INSTAGRAM_APP_SECRET'],amazon:['AMAZON_LWA_CLIENT_ID','AMAZON_LWA_CLIENT_SECRET','AMAZON_APP_ID'],'amazon-refresh':['AMAZON_REFRESH_TOKEN'],
  zoom:['ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET'],googlecalendar:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']};
 if(!Object.hasOwn(requirements,target))throw Error('対象はinstagram / amazon / amazon-refresh / zoom / googlecalendarです');
 const u=new URL(config.vars?.APP_ORIGIN);
 if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(u.hostname)||!/^[-a-z0-9]+$/.test(config.name||''))throw Error('公開Worker名とHTTPSのAPP_ORIGINを確認してください');
 return {mode:'plan',appliesChanges:false,target,worker:config.name,origin:u.origin,requiredNames:requirements[target].filter(n=>n!=='AMAZON_APP_ID'),optionalNames:target==='amazon'?['AMAZON_APP_ID']:[],
  ownerLoginUrl:target==='instagram'?'https://developers.facebook.com/apps/':target==='zoom'?'https://marketplace.zoom.us/':target==='googlecalendar'?'https://console.cloud.google.com/':'https://solutionproviderportal.amazon.com/home',
  callback:target==='instagram'?u.origin+'/api/instagram/callback':target==='amazon'?u.origin+'/api/amazon/callback':target==='zoom'?u.origin+'/api/zoom/callback':target==='googlecalendar'?u.origin+'/api/googlecalendar/callback':null,
  authorization:target==='instagram'?'本人のInstagram OAuth認可が必要':target==='zoom'?'本人のZoom OAuth認可が必要（Server-to-Server OAuthではない）':target==='googlecalendar'?'本人のGoogle OAuth認可が必要（オフラインアクセス・公開ステータスは本番環境）':'自社プライベートアプリのセルフ認可を推奨。OAuth callbackはセルフ認可では不要',
  note:'Secrets登録は別途明示承認後のみ。--applyは本番設定を変更します。本番デプロイ・同期はこの計画では実行しません。'};
}
