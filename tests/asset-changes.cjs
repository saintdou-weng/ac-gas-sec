const assert=require('assert/strict');const {load}=require('./dom-harness.cjs');const {runtime}=require('./backend.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));const state={ptype:'month',period:'2026-09',scope:'all',lang:'en',includeDetails:false};
(async()=>{
 for(const tool of ['fire','cctv']){
  const p=await load(tool==='fire'?'ac_sec_fire_v1.html':'ac_sec_cctv_v2.html'),w=p.w;assert.deepEqual(p.errors,[]);
  try{
   w.SEC.scheduleAutoCloudSync=()=>{};w.PER=new w.SEC.Period('month',new w.Date(2026,8,14));const A=w.SEC.AssetChanges;
   const record=tool==='fire'?{id:'F1',code:'FE01',type:'ext',factory:'a',zone:'bldA',loc:'Gate A',cycle:30,last:'2026-01-01',status:'ok',photos:['normal-old']}:{id:'C1',code:'CCTV A-01',name:'Gate A',type:'dome',factory:'a',zone:'bldA',status:'ok',lastCheck:'2026-01-01',photos:['normal-old']};
   w.DB=[copy(record)];w.ASSET_CHANGES=[];if(tool==='fire')w.HIST=[];else w.LOG=[];
   assert.equal(A.capture(tool,w.ASSET_CHANGES,[copy(record)],[{...copy(record),last:'2026-09-14',lastCheck:'2026-09-14',updatedAt:'2026-09-14T01:00:00Z'}]).length,0,'timestamp/check date alone is not a master change');
   for(const st of [state,{...state,ptype:'week',period:'2026-09-14'},{...state,ptype:'year',period:'2026'},{...state,period:'2026-10'}]){
    const defs=A.pages(tool,[],st);assert.equal(defs.length,1);assert.equal(defs[0].photos.length,0);assert.match(defs[0].text,/No changes/);assert(!/pending|overdue|Abnormal/.test(defs[0].text));
   }
   if(tool==='fire')assert.equal(w.statusOf(w.DB[0]),'ok','old inspection does not make a master overdue');
   w.openEdit(record.id);w.document.querySelector('#e_assetDate').value='2026-09-14';w.document.querySelector('#e_assetKind').value='replace';if(tool==='fire')w.EDIT_FIRE_PHOTOS=['new-device'];else w.EDIT_PHOTOS=['new-device'];w.saveEdit();await w.save();
   assert.equal(w.ASSET_CHANGES.length,1);assert.equal(w.ASSET_CHANGES[0].kind,'replace');assert.equal(w.ASSET_CHANGES[0].before.photos[0],'normal-old');assert.equal(w.ASSET_CHANGES[0].after.photos[0],'new-device');
   w.openEdit(record.id);w.document.querySelector('#e_assetDate').value='2026-09-14';w.document.querySelector('#e_assetKind').value='replace';w.saveEdit();await w.save();assert.equal(w.ASSET_CHANGES.length,1,'repeated identical replacement save cannot double count');
   const defs=A.pages(tool,w.ASSET_CHANGES,state);assert.deepEqual(copy(defs.flatMap(d=>d.photos)),['new-device']);assert(defs[0].text.split('\n').some(l=>l.includes(record.code)&&l.includes('Gate A')));
   assert.equal(A.pages(tool,w.ASSET_CHANGES,{...state,period:'2026-10'})[0].photos.length,0,'replacement photo not re-sent next month');
   if(tool==='cctv'){
    w.document.querySelector('#cDate').value='2026-09-14';w.document.querySelector('#cBy').value='Tester';w.document.querySelector('#cNote').value='No signal';w.TODAY={};w.setBrush('off',true);w.applyCctvBrush(record.id);assert.equal(w.TODAY[record.id],'off');w.saveDay();await w.save();assert.equal(w.LOG[0].off,1);assert.equal(w.LOG[0].st[record.id],'off');
   }
   // Deleting a photo deliberately must survive client and backend merges.
   const photoOld=copy(w.DB[0]);w.openEdit(record.id);w.document.querySelector('#e_assetDate').value='2026-09-14';if(tool==='fire')w.EDIT_FIRE_PHOTOS=[];else w.EDIT_PHOTOS=[];w.saveEdit();await w.save();
   const empty=w.SEC.mergeRecords(tool,[photoOld],copy(w.DB)).records[0];assert.equal(empty.photos.length,0);const server=runtime();assert.equal(server.c.mergeCloudRow(photoOld,copy(w.DB[0])).row.photos.length,0);
   // Ordinary checks never enter the master-change report; only changed faults/evidence/recovery do.
   function history(date,status,photos=[]){return tool==='fire'?{id:'H'+date,date,by:'Inspector',photos:['unrelated-normal'],items:[{...copy(record),result:status,note:status==='fault'?'Broken':'',photos}]}:{id:'L'+date,date,by:'Inspector',note:status==='off'?'No signal':'',st:{C1:status},photos};}
   const fault=tool==='fire'?'fault':'off';let historyRows=[history('2026-09-01','ok',['normal-check']),history('2026-09-02',fault,['fault-evidence']),history('2026-09-03',fault,['fault-evidence']),history('2026-09-04','ok',['normal-recovery'])];
   let events=A.inspectionEvents(tool,historyRows,[record],[]);assert.equal(events.length,2);assert.deepEqual(copy(events.map(e=>e.kind)),['fault','recovered']);assert.deepEqual(copy(events.flatMap(e=>e.photos)),['fault-evidence']);
   const retained=JSON.stringify(historyRows);A.pages(tool,events,state);assert.equal(JSON.stringify(historyRows),retained);
   assert.equal(A.selected(events,{...state,period:'2026-10'}).length,0);
   // Multiple photo pages retain the equipment identity and all exception evidence.
   const photoEvent={id:'photos',date:'2026-09-14',assetId:record.id,kind:'fault',after:record,photos:Array.from({length:9},(_,i)=>'evidence-'+i)};const all=A.pages(tool,[photoEvent],state);assert.equal(all.length,3);assert(all.every(x=>x.photos.length<=4&&x.text.includes(record.code)));assert.equal(all.flatMap(x=>x.photos).length,9);
   const rows=Array.from({length:17},(_,i)=>({id:'e'+i,date:'2026-09-14',kind:'update',assetId:'x'+i,after:{...record,code:'Code '+i}}));assert(A.pages(tool,rows,state).length<=3,'compact changes should batch text rows');
   // Actual send modal has weekly/monthly/yearly options and a distinct request kind.
   w.ASSET_CHANGES=[{...copy(w.ASSET_CHANGES[0]),date:'2026-09-14'}];if(tool==='fire')w.HIST=[];else w.LOG=[];let posted=[];w.doUpload=async()=>true;w.SEC.setCfg({gasUrl:'https://offline.test/gas'});w.fetch=async(url,opt)=>{posted.push(JSON.parse(opt.body));return {ok:true,text:async()=>JSON.stringify({ok:true,data:{sent:true,sentPages:1}})};};
   (tool==='fire'?w.openFireChangesTelegram:w.openCctvChangesTelegram)();const d=w.document;assert.deepEqual(['week','month','year'].map(t=>!!d.querySelector('#tgType option[value="'+t+'"]')),[true,true,true]);assert.equal(d.querySelector('#tgDetailBox').style.display,'none');await d.querySelector('#tgSend').onclick();let body=posted.find(b=>b.action==='telegramBatch');assert.equal(body.reportKind,'masterChanges');assert.deepEqual(body.pages.flatMap(x=>x.photos),['new-device']);
   // Equipment removal retains its change record and existing inspection logs.
   if(tool==='fire')w.HIST=copy(historyRows);else w.LOG=copy(historyRows);w.openEdit(record.id);w.document.querySelector('#e_assetDate').value='2026-09-14';(tool==='fire'?w.delEquip:w.delCam)();await w.save();assert.equal(w.DB.length,0);assert(w.ASSET_CHANGES.some(e=>e.kind==='remove'));assert.equal((tool==='fire'?w.HIST:w.LOG).length,4);
   assert.deepEqual(p.errors,[]);
   console.log('PASS: '+tool+' unchanged carry-forward; real replacement/edit/delete; atomic photo deletion; compact weekly/monthly/yearly changes and fault-only evidence; distinct send payload');
  }finally{w.close();}
 }
 // Full client -> backend smart-sync round trip and no-op upload hashes.
 {
  const p=await load('ac_sec_attendance_v2.html'),w=p.w,r=runtime('2026-09-14T01:00:00Z');
  try{
   w.SEC.setCfg({gasUrl:'https://offline.test/gas'});w.SEC.scheduleAutoCloudSync=()=>{};const calls=[];
   w.fetch=async(url,opt={})=>{let out;if(opt.method==='POST'){const body=JSON.parse(opt.body);calls.push(body.action);out=r.c.doPost({postData:{contents:JSON.stringify(body)}}).text;}else{const u=new URL(url),parameter=Object.fromEntries(u.searchParams);calls.push(parameter.action);out=r.c.doGet({parameter}).text;}return {ok:true,text:async()=>out};};
   const P=w.SEC.Personnel,db=[],changes=[];P.apply(db,changes,{empId:'1',name:'Cloud Guard',status:'active'},{month:'2026-09',date:'2026-09-14'});await P.persist(db,changes);assert(await P.upload());assert(calls.includes('smartCommit'));const n=calls.filter(x=>x==='smartCommit').length;assert(await P.upload());assert.equal(calls.filter(x=>x==='smartCommit').length,n,'identical personnel upload must be a no-op');
   assert(await P.pull({auto:true}));const got=await P.read();assert.equal(got.db.length,1);assert.equal(P.list(got.db,'2026-08').length,0);assert.equal(P.list(got.db,'2026-10').length,1);
   for(const tool of ['fire','cctv']){
    const row={id:'asset',code:tool==='cctv'?'CCTV A-01':'FE01',type:tool==='fire'?'ext':'dome',factory:'a',loc:'Gate',name:'Gate',status:'ok',updatedAt:'2026-09-14T01:00:00Z'},extra={assetChanges:[{id:'e',date:'2026-09-14',kind:'replace',after:row,photos:['new-device']} ]};
    assert(await w.SEC.cloudPush(tool,[row],{},extra));const count=calls.filter(x=>x==='smartCommit').length;assert(await w.SEC.cloudPush(tool,[row],{},extra));assert.equal(calls.filter(x=>x==='smartCommit').length,count,'unchanged asset upload must be a no-op');
    const result=await w.SEC.cloudPull(tool,{force:true,localRecords:[row],localExtra:extra});assert.equal(result.length,1);assert.equal(result._cloudExtra.assetChanges.length,1);
   }
   console.log('PASS: real client/backend personnel/fire/CCTV smart-sync round trips, stable hashes, retained change logs and no-op re-uploads');
  }finally{w.close();}
 }
 {
  const r=runtime('2026-09-14T01:00:00Z'),c=r.c;for(const tool of ['personnel','fire','cctv'])r.disk[tool+'.json']=JSON.stringify({records:[{id:'master',name:'Unchanged',code:tool==='cctv'?'CCTV A-01':'FE01',status:'ok',last:'2026-01-01'}],extra:{}});
  let status=c.monthlyCompleteness('2026-08');for(const tool of ['personnel','fire','cctv']){assert(!status.cloudMissing.includes(tool));assert(!status.summaryMissing.includes(tool));}
  r.disk['fire.json']=JSON.stringify({records:[],extra:{assetChanges:[{id:'new',date:'2026-08-10',kind:'replace'}],history:[{id:'h',date:'2026-08-11',items:[{result:'ok'}]}]}});
  assert(c.monthlyCompleteness('2026-08').summaryMissing.includes('fire'));
  c.markTelegramReport_({module:'fire',reportKind:'masterChanges',periodType:'month',period:'2026-08'});assert(c.monthlyCompleteness('2026-08').summaryMissing.includes('fire'),'master receipt must not close inspection');
  c.markTelegramReport_({module:'fire',reportKind:'inspection',periodType:'month',period:'2026-08'});assert(!c.monthlyCompleteness('2026-08').summaryMissing.includes('fire'));
  r.disk['personnel.json']=JSON.stringify({records:[{id:'p1',_k:'chg',date:'2026-08-10',notified:true}],extra:{}});assert(!c.monthlyCompleteness('2026-08').summaryMissing.includes('personnel'),'individually delivered personnel changes need no repeat month send');
  r.disk['personnel.json']=JSON.stringify({records:[{id:'p1',_k:'chg',date:'2026-08-10',notified:false}],extra:{}});assert(c.monthlyCompleteness('2026-08').summaryMissing.includes('personnel'));
  assert(!c.dispatchReasonReportable_('personnel','startup'));assert(!c.dispatchReasonReportable_('fire','fire-equipment-save'));assert(!c.dispatchReasonReportable_('cctv','master-summary'));assert(c.dispatchReasonReportable_('fire','fire-inspection-save'));
  console.log('PASS: unchanged masters have no monthly obligation; actual changes and inspections have independent monthly receipts; delivered personnel changes are not chased again');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
