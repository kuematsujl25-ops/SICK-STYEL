import {writeFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {bridgeRequest,loadExplicitAsset,readBridgeKey} from './lib/owner-dot-bridge.js';
async function main(){
 const [action,arg,output,...extra]=process.argv.slice(2);
 if(extra.length||!({queue:!arg,receive:!!arg&&!output,complete:!!arg&&!output,upload:!!arg&&isAbsolute(arg)&&!output,download:!!arg&&!!output&&isAbsolute(output)})[action])throw Error('使用法: queue | receive ID | complete ID（結果を標準入力） | upload 絶対パス | download 素材ID 保存先の絶対パス');
 let input={id:arg};
 if(action==='upload')input=await loadExplicitAsset(arg);
 if(action==='complete'){
  let s='';process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){s+=chunk;if(s.length>1800)throw Error('結果は1800文字までです。');}
  input.result=s;
 }
 const data=await bridgeRequest(action,input,await readBridgeKey());
 if(action==='download'){await writeFile(output,data.bytes,{mode:0o600,flag:'wx'});console.log('素材を保存しました。');}
 else console.log(JSON.stringify(data));
}
main().catch(e=>{console.error(e.code?'Dot連携のファイルや端末設定を確認してください。':e.message);process.exitCode=1;});
