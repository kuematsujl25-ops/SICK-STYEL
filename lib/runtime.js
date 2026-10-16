import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const runtime=()=>context.getStore()||process.env;
export const withRuntime=(env,fn)=>context.run(env,fn);
export function getStore(){const store=runtime().STORE;if(!store)throw Error('永続データベースが設定されていません');return store;}
