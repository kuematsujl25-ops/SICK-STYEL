import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyOwnerR2} from '../scripts/lib/deploy-owner-r2.js';
const cfg={r2_buckets:[{binding:'OWNER_MEDIA',bucket_name:'sickstyle-owner-media'}]};
const lines=['{"name":"sickstyle-owner-media","default_storage_class":"Standard"}','Public access via the r2.dev URL is disabled.','There are no custom domains connected to this bucket.'];
test('release verifies the existing private owner bucket with read-only commands',()=>{
 const calls=[];
 assert.equal(verifyOwnerR2(cfg,args=>{calls.push(args);return {status:0,stdout:lines[calls.length-1]};}),true);
 assert.deepEqual(calls,[['r2','bucket','info','sickstyle-owner-media','--json'],['r2','bucket','dev-url','get','sickstyle-owner-media'],['r2','bucket','domain','list','sickstyle-owner-media']]);
 assert.equal(verifyOwnerR2({},()=>assert.fail('unbound environments make no R2 calls')),false);
});
test('unprovisioned bucket, wrong bucket, or public access blocks release',()=>{
 assert.throws(()=>verifyOwnerR2(cfg,()=>({status:1,stdout:''})),/存在/);
 assert.throws(()=>verifyOwnerR2({r2_buckets:[{binding:'OWNER_MEDIA',bucket_name:'wrong'}]},()=>assert.fail()),/接続先/);
 for(const i of [1,2]){let j=0;assert.throws(()=>verifyOwnerR2(cfg,()=>({status:0,stdout:j===i?(j++,'public'):lines[j++]})),/非公開/);}
});
