// A stored authorization is not proof that an external read succeeded.
export function connectionReadiness(status,service,now=Date.now()){
 if(!status?.configured||!status?.connected)return {state:'awaiting_auth',label:'認証待ち',detail:!status?.configured?'アプリ設定待ち':'本人認可待ち'};
 if(service==='instagram'&&typeof status.expiresAt==='number'&&status.expiresAt<=now)return {state:'awaiting_auth',label:'認証待ち',detail:'認可期限切れ・再認可が必要'};
 const c=status.cache;
 if(!c?.syncVerified||!Number.isFinite(Date.parse(c.syncedAt))||c.error||c.salesError||c.ordersError)return {state:'sync_unverified',label:'同期未検証',detail:c?.error||c?.salesError||c?.ordersError?'取得エラーあり・最終成功データと区別してください':'認可設定あり・実データの取得成功は未確認'};
 return {state:'connected',label:'接続済み',detail:'読み取り同期の成功記録あり'};
}
export function selectAmazonSales(status,metrics,currentMonth){
 const c=status?.cache;
 if(status?.connected&&c?.month===currentMonth&&Number.isFinite(c.monthSales)&&Number.isFinite(Date.parse(c.salesSyncedAt))){return {value:c.monthSales,source:'api',syncedAt:c.salesSyncedAt,stale:!!(c.error||c.salesError)};}
 const rows=metrics.filter(m=>m.date?.startsWith(currentMonth));
 return {value:rows.length?rows.every(m=>Number.isFinite(m.sales))?rows.reduce((n,m)=>n+m.sales,0):null:null,source:rows.length?'manual':'missing',syncedAt:null,stale:false};
}

export function syncMessage(status){return status?.cache?.syncVerified?status.cache.warnings?.length?'同期を確認しました。一部の指標は未取得です。':'読み取り同期を確認しました。':'同期未検証です。未取得項目とエラーを確認してください。';}
