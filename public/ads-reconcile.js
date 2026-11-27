// A legacy manual range may cover the whole account. Never silently add it to API rows.
export function reconcileAds(manual,automatic){
 const excluded=automatic.filter(a=>manual.some(m=>m.platform==='Amazon'&&m.periodStart<=a.periodEnd&&m.periodEnd>=a.periodStart));
 return {rows:[...manual,...automatic.filter(a=>!excluded.includes(a))],conflicts:excluded.length};
}
