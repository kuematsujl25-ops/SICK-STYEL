// Adapter-facing normalized contract, not a claim that this is the wire format of Amazon v2026.
// A future adapter must map PACKAGES/FULFILLMENT explicitly. No remote fetching exists here.
export function evidenceScope(p,snapshot,{now,confirmedAt}){
 if(!snapshot||snapshot.source!=='synthetic-v2026'||snapshot.sellerId!=='DEMO-SELLER'||snapshot.marketplaceId!==p.payload.marketplaceId||snapshot.orderId!==p.orderId||snapshot.complete!==true||!Array.isArray(snapshot.includedData)||!['PACKAGES','FULFILLMENT'].every(x=>snapshot.includedData.includes(x)))return null;
 const at=Date.parse(snapshot.capturedAt);
 if(!Number.isFinite(at)||at<confirmedAt||at>now||now-at>60000||!['UNSHIPPED','PARTIALLY_SHIPPED','SHIPPED','CANCELLED','PENDING'].includes(snapshot.fulfillmentStatus)||!Array.isArray(snapshot.packages))return null;
 if(snapshot.packages.some(x=>!x||typeof x!=='object'||!/^\d+$/.test(x.packageReferenceId)||Number(x.packageReferenceId)<1))return null;
 return {at,status:snapshot.fulfillmentStatus};
}
export function assessEvidence(p,snapshot,options){
 const scope=evidenceScope(p,snapshot,options);if(!scope)return {result:'UNRESOLVED'};
 const d=p.payload.packageDetail,found=snapshot.packages.filter(x=>x.packageReferenceId===d.packageReferenceId);
 if(found.length!==1)return {result:'UNRESOLVED'};
 const candidate=found[0];
 const canonical=items=>{
  if(!Array.isArray(items)||!items.length)return null;const seen=new Set();
  for(const i of items){if(typeof i?.orderItemId!=='string'||seen.has(i.orderItemId)||!Number.isSafeInteger(i.quantity)||i.quantity<1)return null;seen.add(i.orderItemId);}
  return JSON.stringify(items.map(i=>[i.orderItemId,i.quantity]).sort((a,b)=>a[0].localeCompare(b[0])));
 };
 const match=candidate.carrierCode===d.carrierCode&&candidate.trackingNumber===d.trackingNumber&&Date.parse(candidate.shipDate)===Date.parse(d.shipDate)&&canonical(candidate.orderItems)!==null&&canonical(candidate.orderItems)===canonical(d.orderItems);
 return match?{result:'MATCH',...scope}:{result:'UNRESOLVED'};
}
export function syntheticEvidence(p,at,packages=[p.payload.packageDetail]){
 return {source:'synthetic-v2026',sellerId:'DEMO-SELLER',marketplaceId:p.payload.marketplaceId,orderId:p.orderId,capturedAt:new Date(at).toISOString(),complete:true,includedData:['PACKAGES','FULFILLMENT'],fulfillmentStatus:'PARTIALLY_SHIPPED',packages:structuredClone(packages)};
}
