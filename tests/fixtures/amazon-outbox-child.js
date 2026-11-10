import {createDemoService} from '../../local/amazon-fulfillment/service.js';
let service;
process.on('message',message=>{
 if(message.action==='init'){service=createDemoService({databasePath:message.path,now:()=>message.now});process.send({ready:true});return;}
 try{let result;const actor={id:'test-admin',role:'admin',mfa:true};
  if(message.action==='confirm')result=service.confirm(actor,message.id,'CONFIRM_SYNTHETIC_SHIPMENT');
  if(['claim','claim-and-crash'].includes(message.action))result=service.claim(actor,message.id);
  if(message.action==='preview')result=service.preview(actor,'DEMO-ORDER-1',message.input);
  if(message.action==='claim-and-crash'){process.send({ok:true,result},()=>process.kill(process.pid,'SIGKILL'));return;}
  process.send({ok:true,result});
 }catch(e){process.send({ok:false,code:e.code||'FAILED'});}
 service.close();process.disconnect();
});
