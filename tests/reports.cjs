const assert=require('assert/strict');
const {load}=require('./dom-harness.cjs');
const state={ptype:'month',period:'2026-09',scope:'all',lang:'zh',includeDetails:false};
const plain=x=>JSON.parse(JSON.stringify(x));
(async()=>{
 const fire=await load('ac_sec_fire_v1.html'),w=fire.w;assert.deepEqual(fire.errors,[]);
 try{
  const records=Array.from({length:220},(_,i)=>({id:'E'+i,code:'FE'+String(i+1).padStart(3,'0'),type:'ext',factory:i<110?'a':'b',zone:i<110?'bldA':'bldB',loc:'Location '+i,status:'ok',last:'2026-09-12',photos:['normal-'+i]}));
  w.DB=plain(records);w.HIST=[{id:'H1',date:'2026-09-12',by:'Jenny',photos:['normal-shared'],items:records.map(r=>({...r,result:'ok'}))}];
  const before=JSON.stringify([w.DB,w.HIST]);
  for(const details of [false,true]){
   const st={...state,includeDetails:details};
   for(const defs of [w.fireEquipmentPageDefs(st),w.fireInspectionPageDefs(st)]){
    assert.equal(defs.flatMap(d=>d.photos).length,0,'normal monthly photos excluded even with details');
    assert(defs.length<=20);assert(defs.every(d=>d.text.length<3800));
    if(!details)assert.equal(defs.length,1,'220 normal inspections need just the overview');
    else{const rows=defs.slice(1).flatMap(d=>d.text.split('\n').slice(1));assert.equal(rows.length,220);for(let i=0;i<220;i++)assert(rows.some(s=>s.includes(records[i].code)&&s.includes('Location '+i)));}
   }
  }
  assert.equal(JSON.stringify([w.DB,w.HIST]),before,'report must not mutate stored records/photos');
  for(let i=0;i<5;i++){w.HIST[0].items[i].result='fault';w.HIST[0].items[i].note='Pressure low';w.HIST[0].items[i].photos=['fault-'+i+'a','fault-'+i+'b'];}
  for(const details of [false,true]){
   const st={...state,includeDetails:details};
   for(const defs of [w.fireEquipmentPageDefs(st),w.fireInspectionPageDefs(st)]){
    const ph=defs.flatMap(d=>plain(d.photos));assert.equal(ph.length,10);assert.equal(new Set(ph).size,10);assert(ph.every(x=>x.startsWith('fault-')));assert(defs.every(d=>d.photos.length<=4));
    for(const d of defs.slice(1))for(const p of d.photos){const i=Number(p.match(/fault-(\d+)/)[1]);assert(d.text.includes(records[i].code)&&d.text.includes(records[i].loc),'photo must accompany its equipment/location row');}
   }
  }
  // Monthly latest-state dedupe remains: rechecking an item does not count it twice.
  w.HIST.push({id:'H2',date:'2026-09-13',by:'Phea',items:[{...w.HIST[0].items[0],result:'ok',photos:['repaired-normal']} ]});
  assert.equal(w.fireInspectionRows(state).length,220);
  assert.equal(w.fireInspectionPageDefs(state).flatMap(d=>d.photos).length,8);
  assert(w.fireInspectionPageDefs({...state,ptype:'day',period:'2026-09-12',includeDetails:true}).flatMap(d=>d.photos).some(x=>x.startsWith('normal-')),'daily detail attachments preserved');
  assert(w.fireInspectionPageDefs({...state,scope:'factory:b'}).flatMap(d=>d.photos).length===0,'scope must exclude unrelated photos');
  w.HIST=[{id:'legacy',date:'2026-09-10',by:'Jenny',n:3,ok:2,bad:1,badList:['FE009 · Pump room · No light'],photos:['legacy-fault']}];
  assert.deepEqual(plain(w.fireInspectionPageDefs(state).flatMap(d=>d.photos)),['legacy-fault']);
  assert.deepEqual(plain(w.fireEquipmentPageDefs(state).flatMap(d=>d.photos)),['legacy-fault']);
  // Exercise the real modal -> bilingual merge -> serialized request path.
  w.DB=plain(records.slice(0,2));w.HIST=[{id:'send',date:'2026-09-12',by:'Jenny',items:w.DB.map((r,i)=>({...r,result:i?'ok':'fault',photos:[i?'normal-upload':'fault-upload']}))}];
  w.PER=new w.SEC.Period('month',new w.Date(2026,8,12));w.SEC.setCfg({gasUrl:'https://offline.test/gas'});
  const posted=[];w.fetch=async(url,opt)=>{posted.push(JSON.parse(opt.body));return {ok:true,text:async()=>JSON.stringify({ok:true,data:{sent:true,sentPages:2}})};};
  for(const details of [false,true]){
    w.openFireInspectionTelegram();if(details){const cb=w.document.querySelector('#tgDetails');cb.checked=true;cb.onchange();}
    await w.document.querySelector('#tgSend').onclick();
    const body=posted.filter(p=>p.action==='telegramBatch').at(-1);assert(body);assert.equal(body.period,'2026-09');
    assert.deepEqual(body.pages.flatMap(p=>p.photos),['fault-upload']);
    assert.equal(body.pages.map(p=>p.text).join('\n').split('FE001').length-1,1,'bilingual merge must not repeat the equipment row');
  }
  console.log('PASS: fire compact/full monthly and daily reports; all normal photos excluded, all abnormal photos retained, scope and latest-state counts preserved');
 }finally{fire.dom.window.close();}
 const commute=await load('ac_sec_commute_v2.html'),c=commute.w;assert.deepEqual(commute.errors,[]);
 try{
  c.CAR=[{id:'same-id',date:'2026-09-12',driver:'Driver A',outTime:'08:00',inTime:'09:00',reason:'Delivery'}];
  c.BIKE=[{id:'same-id',date:'2026-09-12',a:171,b:33,total:204}];c.GATE=[{id:'G1',date:'2026-09-12',plate:'A123'}];c.LATE=[{id:'L1',date:'2026-09-12',name:'A'}];
  c.openCommuteTelegram();const d=c.document,scope=d.querySelector('#tgScope'),approval=d.querySelector('[data-tg-mode="approval"]');
  function set(value){scope.value=value;scope.onchange();}
  for(const s of ['all','bike','gate','late']){set(s);assert(approval.hidden&&approval.disabled);assert.equal(c.commuteApprovalItems({...state,scope:s}).length,0);}
  set('vehicle');assert(!approval.hidden&&!approval.disabled);approval.click();assert(approval.classList.contains('on'));
  const items=c.commuteApprovalItems({...state,scope:'vehicle'});assert.equal(items.length,1);assert.equal(items[0].kind,'commute-vehicle');
  set('bike');assert(d.querySelector('[data-tg-mode="summary"]').classList.contains('on'));assert(approval.hidden);assert(!d.querySelector('#tgPreview').textContent.includes('approval request'));
  c.save=()=>{};c.renderAll=()=>{};c.SEC.scheduleAutoCloudSync=()=>{};
  c.commuteApprovalSent({batchId:'VG1'},{...state,scope:'vehicle'},items);
  assert.equal(c.CAR[0].approvalBatch,'VG1');assert.equal(c.BIKE[0].approvalBatch,undefined,'same ID in unrelated category must remain unchanged');
  for(const module of ['container','patrol','cctv','fire'])await assert.rejects(c.SEC.sendApproval({module,items:[{id:'1',kind:'commute-vehicle',group:'vehicle'}]}),/summary-only|不需核可/);
  await assert.rejects(c.SEC.sendApproval({module:'commute',items:[{id:'1',kind:'commute-bike',group:'bike'}]}),/summary-only|不需核可/);
  console.log('PASS: scope-aware approval UI, direct request rejection and category-isolated record updates');
 }finally{commute.dom.window.close();}
 // Load every remaining page with real shared scripts; external network is blocked.
 for(const file of ['index.html','ac_sec_container_v2.html','ac_sec_cctv_v2.html','ac_sec_patrol_v2.html','ac_sec_expense_v1.html','ac_sec_attendance_v2.html','ac_sec_personnel_v1.html']){
  const p=await load(file);try{assert.deepEqual(p.errors,[],file);}finally{p.dom.window.close();}
 }
 console.log('PASS: all nine SEC pages initialize without script errors');
})().catch(e=>{console.error(e);process.exitCode=1;});
