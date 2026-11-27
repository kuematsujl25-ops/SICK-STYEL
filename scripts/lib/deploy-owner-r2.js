// The existing production release never provisions a bucket or enables public access.
export function verifyOwnerR2(config,wrangler){
 const row=config.r2_buckets?.find(x=>x.binding==='OWNER_MEDIA');
 if(!row)return false;
 if(row.bucket_name!=='sickstyle-owner-media')throw Error('本人専用R2の接続先を確認してください');
 const name=row.bucket_name;
 const info=wrangler(['r2','bucket','info',name,'--json']);
 let bucket;
 try{if(info.status===0)bucket=JSON.parse(info.stdout);}catch{/* Fail closed. */}
 if(bucket?.name!==name||bucket.default_storage_class!=='Standard')
  throw Error('承認済みのR2が存在することを確認できません。新規作成は別手順です');
 const dev=wrangler(['r2','bucket','dev-url','get',name]);
 const domains=wrangler(['r2','bucket','domain','list',name]);
 if(dev.status!==0||!/^Public access via the r2\.dev URL is disabled\.$/m.test(dev.stdout)||
    domains.status!==0||!/^There are no custom domains connected to this bucket\.$/m.test(domains.stdout))
  throw Error('R2が非公開であることを確認できません。公開状態を変更せず停止しました');
 return true;
}
