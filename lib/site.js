// 公開サイト（sickstyle-site）に掲載する情報。業務データ（workspace）や注文・顧客情報とは別ドキュメントで管理します。
// site-draft: 管理アプリで編集する下書き / site-public: 公開APIで配信する確定版（公開操作でのみ更新）
export const emptySite=()=>({products:[],news:[],players:[],philosophy:{origin:'',mission:'',missionNote:'',vision:'',visionNote:'',values:[]},links:{amazon:'',store:'',wholesale:''}});
const bad=m=>{throw Error('サイト掲載データの形式が正しくありません'+(m?`（${m}）`:''));};
const text=(v,max)=>typeof v==='string'&&v.length<=max;
// 外部リンク・画像は https のみ（または同一サイト内の / から始まるパス）。javascript: 等は拒否。
export function safeUrl(v,{allowPath=false}={}){if(v==='')return true;if(typeof v!=='string'||v.length>2000)return false;if(allowPath&&/^\/[A-Za-z0-9._~\-\/]*$/.test(v)&&!v.startsWith('//'))return true;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
const date=v=>text(v,10)&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function validateSite(d){
 if(!d||typeof d!=='object'||Array.isArray(d))bad();
 const out=emptySite();
 if(!Array.isArray(d.products)||d.products.length>100)bad('商品');
 const ids=new Set();
 out.products=d.products.map(p=>{
  if(!p||!text(p.id,100)||!p.id||ids.has(p.id))bad('商品ID');ids.add(p.id);
  if(!text(p.name,120)||!p.name.trim())bad('商品名');
  if(!Number.isInteger(p.price)||p.price<0||p.price>10000000)bad('価格（円・整数）');
  for(const k of ['description','badge'])if(p[k]!==undefined&&!text(p[k],k==='badge'?30:2000))bad(k);
  if(p.image!==undefined&&!safeUrl(p.image,{allowPath:true}))bad('画像URL');
  for(const k of ['amazonUrl','storeUrl'])if(p[k]!==undefined&&!safeUrl(p[k]))bad('リンクURL');
  if(!['available','soldout','hidden'].includes(p.storeStatus))bad('自社ECの状態');
  if(!['available','soldout','hidden'].includes(p.amazonStatus))bad('Amazonの状態');
  if(!Number.isInteger(p.sortOrder)||p.sortOrder<0||p.sortOrder>9999)bad('表示順');
  if(typeof p.published!=='boolean')bad('掲載');
  return {id:p.id,name:p.name.trim(),price:p.price,description:p.description||'',badge:p.badge||'',image:p.image||'',amazonUrl:p.amazonUrl||'',storeUrl:p.storeUrl||'',amazonStatus:p.amazonStatus,storeStatus:p.storeStatus,sortOrder:p.sortOrder,published:p.published};
 });
 if(!Array.isArray(d.news)||d.news.length>500)bad('お知らせ');
 const nids=new Set();
 out.news=d.news.map(n=>{
  if(!n||!text(n.id,100)||!n.id||nids.has(n.id))bad('お知らせID');nids.add(n.id);
  if(!date(n.date))bad('日付');if(!text(n.title,200)||!n.title.trim())bad('タイトル');
  if(n.body!==undefined&&!text(n.body,5000))bad('本文');if(n.url!==undefined&&!safeUrl(n.url))bad('リンクURL');
  if(typeof n.published!=='boolean')bad('掲載');
  return {id:n.id,date:n.date,title:n.title.trim(),body:n.body||'',url:n.url||'',published:n.published};
 });
 // 選手は「提供が確定した」ものだけを管理画面から個別に選んで掲載する。写真を掲載する場合は権利者・出典URLを必須にする。
 if(!Array.isArray(d.players)||d.players.length>100)bad('選手掲載');
 const plids=new Set();
 out.players=d.players.map(pl=>{
  if(!pl||!text(pl.id,100)||!pl.id||plids.has(pl.id))bad('選手掲載ID');plids.add(pl.id);
  if(!text(pl.name,200)||!pl.name.trim())bad('選手名');
  if(!['Jリーグ','海外'].includes(pl.league))bad('リーグ区分');
  for(const k of ['affiliation','position','note'])if(pl[k]!==undefined&&!text(pl[k],k==='note'?2000:200))bad(k);
  if(pl.photo!==undefined&&!safeUrl(pl.photo))bad('選手写真URL');
  if(pl.photo&&(!text(pl.photoCredit,500)||!pl.photoCredit.trim()||!safeUrl(pl.photoSourceUrl)||!pl.photoSourceUrl))bad('選手写真の権利者・出典URLは写真を掲載する場合に必須です');
  if(pl.profileUrl!==undefined&&!safeUrl(pl.profileUrl))bad('選手プロフィールURL');
  if(!Number.isInteger(pl.sortOrder)||pl.sortOrder<0||pl.sortOrder>9999)bad('表示順');
  if(typeof pl.published!=='boolean')bad('選手の掲載');
  return {id:pl.id,name:pl.name.trim(),league:pl.league,affiliation:pl.affiliation||'',position:pl.position||'',note:pl.note||'',photo:pl.photo||'',photoCredit:pl.photoCredit||'',photoSourceUrl:pl.photoSourceUrl||'',profileUrl:pl.profileUrl||'',sortOrder:pl.sortOrder,published:pl.published};
 });
 const ph=d.philosophy;if(!ph||typeof ph!=='object')bad('ブランド理念');
 for(const k of ['origin','mission','missionNote','vision','visionNote'])if(!text(ph[k]??'',5000))bad(k);
 if(!Array.isArray(ph.values)||ph.values.length>10)bad('Values');
 out.philosophy={origin:ph.origin||'',mission:ph.mission||'',missionNote:ph.missionNote||'',vision:ph.vision||'',visionNote:ph.visionNote||'',values:ph.values.map(v=>{if(!v||!text(v.title,100)||!v.title.trim()||!text(v.body??'',1000))bad('Values');return {title:v.title.trim(),body:v.body||''};})};
 const l=d.links||{};for(const k of ['amazon','store','wholesale'])if(!safeUrl(l[k]??''))bad('購入先リンク');
 out.links={amazon:l.amazon||'',store:l.store||'',wholesale:l.wholesale||''};
 return out;
}
// 公開APIに出す形。非掲載の商品・お知らせ、内部ID以外の管理用項目は含めません。
export function publicView(site,publishedAt){
 const s=validateSite(site);
 return {version:1,publishedAt,
  products:s.products.filter(p=>p.published).sort((a,b)=>a.sortOrder-b.sortOrder).map(({published,sortOrder,...p})=>({...p,amazonUrl:p.amazonStatus==='hidden'?'':p.amazonUrl,storeUrl:p.storeStatus==='hidden'?'':p.storeUrl})),
  news:s.news.filter(n=>n.published).sort((a,b)=>b.date.localeCompare(a.date)).map(({published,...n})=>n),
  players:s.players.filter(p=>p.published).sort((a,b)=>a.sortOrder-b.sortOrder).map(({published,sortOrder,...p})=>p),
  philosophy:s.philosophy,links:s.links};
}
export const DEFAULT_SITE_ORIGINS=['https://sickstyle-site.vercel.app','https://sickstyle.net','https://www.sickstyle.net'];
