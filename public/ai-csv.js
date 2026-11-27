// Official dashboard data supplied by the owner. No API calls or KPI aggregation.
const metrics = {base:{sales:'JPY',orders:'count',visits:'count'},
  tiktok:{views:'count',profile_views:'count',followers:'count'},
  metricool:{reach:'count',engagement:'count',clicks:'count'}};

function rows(text) {
  const result=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error('CSVの引用符を確認してください');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(row.some(x=>x.trim()))result.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    } else {if(closed)throw Error('CSVの引用符の後に文字があります');cell+=c;}
  }
  if(quoted)throw Error('CSVの引用符が閉じていません');
  row.push(cell);if(row.some(x=>x.trim()))result.push(row);
  return result;
}

export function parseTeamCSV(text,now=new Date()) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>100000)throw Error('CSVは100KB以内にしてください');
  const table=rows(text.replace(/^\uFEFF/,''));
  const header=table.shift();
  const base=['service','date_jst','metric','value','unit','source','observed_at'];
  const metricool=['service','date_jst','channel','metric','value','unit','source','observed_at'];
  if(!header||![base,metricool].some(h=>JSON.stringify(h)===JSON.stringify(header)))
    throw Error('BASE・TikTok・Metricoolの指定CSVテンプレートを使ってください');
  if(!table.length||table.length>30)throw Error('CSVのデータ行は1〜30件にしてください');
  const seen=new Set();
  const today=now.toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  return table.map((row,i)=>{
    if(row.length!==header.length)throw Error(`CSV ${i+2}行目の列数を確認してください`);
    const r=Object.fromEntries(header.map((k,j)=>[k,row[j].trim()]));
    const fail=()=>{throw Error(`CSV ${i+2}行目のサービス・指標・単位・日付・取得元・値を確認してください`);};
    if(!Object.hasOwn(metrics,r.service)||!Object.hasOwn(metrics[r.service],r.metric)||r.unit!==metrics[r.service][r.metric])fail();
    if(r.service==='metricool'?!r.channel||r.channel.length>40:!!r.channel)fail();
    const day=Date.parse(r.date_jst+'T00:00:00Z');
    if(!/^\d{4}-\d\d-\d\d$/.test(r.date_jst)||!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==r.date_jst||r.date_jst>today)fail();
    const observed=Date.parse(r.observed_at);
    if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(r.observed_at)||!Number.isFinite(observed)||observed>now.getTime()+300000||observed<Date.parse(r.date_jst+'T00:00:00+09:00')||!r.source||r.source.length>300)fail();
    const id=[r.service,r.date_jst,r.channel||'',r.metric].join('/');
    if(seen.has(id))throw Error(`CSV ${i+2}行目の指標が重複しています`);seen.add(id);
    let value=null;
    if(r.value!==''){
      if(!/^\d+(?:\.\d{1,2})?$/.test(r.value))fail();value=Number(r.value);
      if(!Number.isFinite(value)||value>1e12||r.unit==='count'&&!Number.isSafeInteger(value))fail();
    }
    return {id:'csv'+(i+1),label:[r.service,r.channel,r.metric,r.date_jst].filter(Boolean).join(' / '),
      value,unit:r.unit,source:r.source,observed_at:r.observed_at,kind:'observed'};
  });
}
