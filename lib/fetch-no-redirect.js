// Workerd does not implement Fetch's redirect:"error" mode. Use "manual"
// without ever reading Location or making a second request.
export async function fetchNoRedirect(url, options = {}, request = fetch) {
 const response=await request(url,{...options,redirect:'manual'});
 if(response.status>=300&&response.status<400) {
  try{await response.body?.cancel();}catch{}
  throw new Error('予期しないHTTP転送を拒否しました');
 }
 return response;
}
