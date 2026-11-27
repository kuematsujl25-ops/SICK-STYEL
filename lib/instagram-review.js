const DOC='instagram-metricool-review';
export const REVIEW_LIMIT=64_000;
export class InstagramReviewError extends Error{
 constructor(message,status=400){super(message);this.status=status;}
}
const bad=(message)=>{throw new InstagramReviewError(message);};
const obj=(value,keys)=>{
 if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k)))bad('指定フォーマットのJSONを選択してください。');
 return value;
};
const text=(v,max,required=false)=>{
 if(typeof v!=='string'||v.length>max||(required&&!v.trim())||/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(v))bad('文字項目の形式または長さを確認してください。');
 return v.trim();
};
const list=(v,max,mapper)=>{if(!Array.isArray(v)||v.length>max)bad('一覧の形式または件数を確認してください。');return v.map(mapper);};
const instant=(v)=>{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v))bad('日時はタイムゾーン付きで指定してください。');
 day(v.slice(0,10));if(Number(v.slice(11,13))>23)bad('無効な日時です。');const t=Date.parse(v);if(!Number.isFinite(t))bad('無効な日時です。');
 return new Date(t).toISOString();
};
const day=(v)=>{
 if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v))bad('日付の形式を確認してください。');
 const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)bad('無効な日付です。');
 return v;
};
const metric=(v)=>{
 if(v===null)return null;
 if(!Number.isSafeInteger(v)||v<0)bad('指標は整数、未取得は null にしてください。');
 return v;
};
const reportLink=(v)=>{
 if(v===null||v===undefined||v==='')return null;
 let u;try{u=new URL(text(v,500));}catch{bad('予約リンクはMetricoolのURLを指定してください。');}
 if(u.origin!=='https://app.metricool.com'||u.username||u.password)bad('予約リンクはMetricoolのURLを指定してください。');
 return u.href;
};
function analysis(v){
 if(v===null)return null;
 const a=obj(v,['from','to','reelCount','medianViews','medianReach','saves','shares','findings','recommendations']);
 const from=day(a.from),to=day(a.to);
 if(from>to)bad('分析期間の開始・終了を確認してください。');
 return {from,to,reelCount:metric(a.reelCount),medianViews:metric(a.medianViews),medianReach:metric(a.medianReach),saves:metric(a.saves),shares:metric(a.shares),findings:list(a.findings,5,x=>text(x,500,true)),recommendations:list(a.recommendations,5,x=>text(x,500,true))};
}
function planner(v){
 if(v===null)return null;
 const p=obj(v,['from','to','posts']);const from=instant(p.from),to=instant(p.to);
 if(from>to||Date.parse(to)-Date.parse(from)>62*86_400_000)bad('予約一覧の期間は62日以内にしてください。');
 const ids=new Set();
 const posts=list(p.posts,150,input=>{
  const item=obj(input,['id','at','type','caption','url']);const id=text(item.id,120,true),at=instant(item.at);
  if(!['reel','carousel','image','story','unknown'].includes(item.type)||ids.has(id)||at<from||at>to)bad('予約の種別、重複または対象期間を確認してください。');
  ids.add(id);return {id,at,type:item.type,caption:text(item.caption,2200),url:reportLink(item.url)};
 }).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
 return {from,to,posts};
}
export function validateInstagramReview(v,now=Date.now()){
 const s=obj(v,['version','source','account','observedAt','analysis','planner']);
 if(s.version!==1||s.source!=='metricool')bad('Metricool確認用のJSONを選択してください。');
 if(typeof s.account!=='string'||!/^@?[a-z\d._]{1,30}$/i.test(s.account))bad('Instagramのアカウント名を確認してください。');
 const observedAt=instant(s.observedAt);
 if(Date.parse(observedAt)>now+300_000)bad('取得日時が未来になっています。');
 const a=analysis(s.analysis),p=planner(s.planner);
 if(a===null&&p===null)bad('分析または予約一覧を含めてください。');
 return {version:1,source:'metricool',account:s.account.replace(/^@/,'').toLowerCase(),observedAt,analysis:a,planner:p};
}
export async function readInstagramReview(store){
 const row=await store.doc(DOC);
 return {snapshot:row?JSON.parse(row.body):null,revision:row?.revision??null};
}
export async function saveInstagramReview(store,input){
 const b=obj(input,['snapshot','revision']);const s=validateInstagramReview(b.snapshot);
 if(b.revision!==null&&(!Number.isSafeInteger(b.revision)||b.revision<0))bad('先に画面を更新してください。');
 const current=await readInstagramReview(store);
 if(current.revision!==b.revision)throw new InstagramReviewError('別の端末で更新されました。再読み込みしてください。',409);
 if(current.snapshot?.account&&s.account!==current.snapshot.account)bad('保存済みのInstagramアカウントと一致しません。');
 const merge=(key)=>{
  const next=s[key],old=current.snapshot?.[key]??null;
  if(next===null)return old;
  if(old&&old.observedAt>s.observedAt)throw new InstagramReviewError('保存済みより古い取得データです。',409);
  return {...next,observedAt:s.observedAt};
 };
 const snapshot={version:1,source:s.source,account:s.account,analysis:merge('analysis'),planner:merge('planner')};
 const body=JSON.stringify(snapshot);
 if(Buffer.byteLength(body)>REVIEW_LIMIT)throw new InstagramReviewError('保存サイズを超えています。期間または件数を絞ってください。',413);
 const rows=b.revision===null
  ?await store.query('INSERT INTO ss_documents(name,body,revision) VALUES ($1,$2,0) ON CONFLICT(name) DO NOTHING RETURNING revision',[DOC,body])
  :await store.query('UPDATE ss_documents SET body=$1,revision=revision+1 WHERE name=$2 AND revision=$3 RETURNING revision',[body,DOC,b.revision]);
 if(!rows.length)throw new InstagramReviewError('別の端末で更新されました。再読み込みしてください。',409);
 return {snapshot,revision:rows[0].revision};
}
