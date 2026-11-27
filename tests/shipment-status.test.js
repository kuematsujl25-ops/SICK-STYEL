import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let shipmentSavingId=null;'),source.indexOf('function collection(key)'));
function harness(persist){
 const record={id:'s1',title:'Test order',status:'未発送',tracking:'keep',notes:'keep'},state={revision:7,shipments:[record],tasks:[{id:'t1'}]};
 const hint={textContent:''},control={dataset:{shipmentStatus:'s1'},value:'準備中',disabled:false,isConnected:true,closest:()=>({querySelector:()=>hint})};
 const other={disabled:false,isConnected:true};const messages=[];let writes=[];
 const ctx=vm.createContext({state,busy:false,structuredClone,esc:v=>String(v).replaceAll('"','&quot;'),app:{querySelectorAll:()=>[control,other]},document:{querySelectorAll:()=>[control]},toast:m=>messages.push(m),persist:async n=>{writes.push(n);if(persist)await persist(n);ctx.state=n;}});
 vm.runInContext(code+'\nthis.changeShipmentStatus=changeShipmentStatus;this.shipmentStatusControl=shipmentStatusControl;',ctx);
 return {ctx,state,control,other,hint,messages,writes};
}
test('status control exposes four options and an accessible order-specific label',()=>{const h=harness();const html=h.ctx.shipmentStatusControl(h.state.shipments[0]);assert.match(html,/aria-label="Test orderの発送状況"/);assert.equal((html.match(/<option /g)||[]).length,4);assert.match(html,/選ぶと保存/);});
test('inline change preserves all other fields and revision',async()=>{const h=harness();await h.ctx.changeShipmentStatus(h.control);assert.equal(h.writes.length,1);assert.equal(h.writes[0].revision,7);assert.equal(h.writes[0].shipments[0].status,'準備中');assert.equal(h.writes[0].shipments[0].tracking,'keep');assert.deepEqual(h.writes[0].tasks,h.state.tasks);assert.equal(h.state.shipments[0].status,'未発送');assert.equal(h.control.disabled,false);});
test('duplicate actions are suppressed and edit controls disabled while saving',async()=>{let finish;const h=harness(()=>new Promise(r=>finish=r));const pending=h.ctx.changeShipmentStatus(h.control);assert.equal(h.control.disabled,true);assert.equal(h.other.disabled,true);await h.ctx.changeShipmentStatus(h.control);assert.equal(h.writes.length,1);finish();await pending;assert.equal(h.other.disabled,false);});
test('save errors restore displayed status without claiming server rollback',async()=>{const h=harness(()=>{throw Error('conflict');});await h.ctx.changeShipmentStatus(h.control);assert.equal(h.control.value,'未発送');assert.equal(h.hint.textContent,'保存できませんでした');assert.match(h.messages.at(-1),/保存結果を確認できません/);assert.equal(h.other.disabled,false);});
test('existing save, no-op, invalid and missing shipment do not write',async()=>{for(const kind of ['busy','same','invalid','missing']){const h=harness();if(kind==='busy')h.ctx.busy=true;if(kind==='same')h.control.value='未発送';if(kind==='invalid')h.control.value='bad';if(kind==='missing')h.control.dataset.shipmentStatus='missing';await h.ctx.changeShipmentStatus(h.control);assert.equal(h.writes.length,0);}});
test('status control escapes record identifiers and titles',()=>{const h=harness();const html=h.ctx.shipmentStatusControl({id:'" autofocus="',title:'" onfocus="',status:'未発送'});assert.doesNotMatch(html,/id=""/);assert.match(html,/&quot;/);});
