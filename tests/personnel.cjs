const assert=require('assert/strict');
const {load}=require('./dom-harness.cjs');
const {runtime}=require('./backend.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const month=(w,m)=>new w.SEC.Period('month',new w.Date(m+'-01T12:00:00'));
const state={ptype:'month',period:'2026-09',scope:'changes',lang:'en',includeDetails:false};
const original={id:'S1',empId:'A001',name:'Original Guard',shift:'A',post:'Gate A',status:'active',photo:'old-photo',createdAt:'2026-06-01T01:00:00Z'};
(async()=>{
 const page=await load('ac_sec_attendance_v2.html'),w=page.w,P=w.SEC.Personnel;assert.deepEqual(page.errors,[]);
 try{
  w.SEC.scheduleAutoCloudSync=()=>{};w.SEC.setCfg({operator:'Tester'});
  const db=[copy(original)],changes=[];
  const edit=P.apply(db,changes,{...original,name:'Renamed Guard',empId:'A009',shift:'B',post:'',photo:''},{id:'S1',month:'2026-09',date:'2026-09-14'});
  assert.equal(P.snapshot(db[0],'2026-08').name,'Original Guard');assert.equal(P.snapshot(db[0],'2026-08').empId,'A001');
  assert.equal(P.snapshot(db[0],'2026-09').name,'Renamed Guard');assert.equal(P.snapshot(db[0],'2026-10').post,'');assert.equal(P.snapshot(db[0],'2026-09')._attKey,'A001');
  assert.equal(P.snapshot(db[0],'2026-08').photo,'old-photo');assert.equal(P.snapshot(db[0],'2026-09').photo,'');
  assert.equal(P.apply(db,changes,{...P.snapshot(db[0],'2026-09')},{id:'S1',month:'2026-09',date:'2026-09-14'}).changed,false);assert.equal(changes.length,1);
  const pre=JSON.stringify(db);assert.throws(()=>P.apply(db,changes,{...original,name:'Bad month'},{id:'S1',changeId:edit.change.id,month:'2026-10',date:'2026-10-01'}),/原生效月份/);assert.equal(JSON.stringify(db),pre);
  P.apply(db,changes,{...P.snapshot(db[0],'2026-09')},{id:'S1',changeId:edit.change.id,month:'2026-09',date:'2026-09-14',reason:'Corrected reason'});assert.equal(changes.length,1);assert.equal(changes[0].reason,'Corrected reason');
  const join=P.apply(db,changes,{empId:'A002',name:'New Guard',shift:'C',status:'active'},{month:'2026-09',date:'2026-09-14'});
  assert.equal(P.list(db,'2026-08').length,1);assert.equal(P.list(db,'2026-09').length,2);assert.equal(P.list(db,'2026-10').length,2);
  assert.equal(P.apply(db,changes,{empId:'A002',name:'New Guard',shift:'C',status:'active'},{month:'2026-09',date:'2026-09-14'}).changed,false);
  assert.throws(()=>P.apply(db,changes,{...original,empId:'A002'},{id:'S1',month:'2026-09',date:'2026-09-14'}),/already exists|已存在/);
  assert.throws(()=>P.apply(db,changes,{name:'Green= take Leave A'},{month:'2026-09',date:'2026-09-14'}),/legend|說明列/);
  P.apply(db,changes,{...P.snapshot(db[0],'2026-10'),post:'Future gate'},{id:'S1',month:'2026-11',date:'2026-11-01'});
  P.apply(db,changes,{...P.snapshot(db[0],'2026-09'),status:'resigned'},{id:'S1',month:'2026-09',date:'2026-09-14'});
  assert.equal(P.list(db,'2026-08').length,1);assert.equal(P.list(db,'2026-09').length,1);assert.equal(P.list(db,'2026-10').length,1);assert.equal(P.snapshot(db[0],'2026-11').post,'Future gate','explicit future version retained');
  w.ALL_STAFF=copy(db);w.ATT={'2026-08':{A001:{'01':'W','02':'O'}},'2026-09':{A001:{'01':'W'},A002:{'15':'W'},'Red= Dayoff A':{}}};w.ATT_LOG=[];w.ATT_INFO={};w.PER=month(w,'2026-09');w.captureAttendanceInfo();w.renderAll();
  assert.equal(w.STAFF.length,2);assert(w.STAFF.find(r=>r.id==='S1')._archived);assert.equal(w.stats(w.STAFF.find(r=>r.id==='S1')).hrs,12);
  assert.equal(w.attendanceMonthStaff('2026-10').length,1,'resigned row with prior-month hours must not carry forward');
  const august=w.attendancePeriodStaff(month(w,'2026-08'));assert.equal(august[0].name,'Original Guard');assert.equal(w.attendanceStatsFor(august[0],month(w,'2026-08')).hrs,30);
  assert.equal(w.attendanceRowRecord('2026-08','A001',w.ATT['2026-08'].A001)._recordKey,'attendance|month|2026-08|A001');
  const year=new w.SEC.Period('year',new w.Date(2026,0,1));assert.equal(w.attendancePeriodStaff(year).reduce((n,r)=>n+w.attendanceStatsFor(r,year).hrs,0),54,'one person/month must count once across name/ID changes');
  const historical=w.attendanceSummary({...state,period:'2026-08',includeDetails:true});assert.match(historical,/Hours⟧ <b>30h<\/b>/,'August total hours = 30');
  assert(w.document.querySelector('[data-edit-person="S1"]'));assert(w.document.querySelector('[data-remove-person="S1"]'));
  const unchanged=JSON.stringify(w.ATT);w.fillMonth();assert.equal(JSON.stringify(w.ATT['2026-09'].A001),JSON.stringify({'01':'W'}),'bulk fill skips departed staff');w.ATT=JSON.parse(unchanged);
  // Concurrent local saves and stale cloud merges retain separate month versions, including deliberate blanks.
  const first=[copy(original)],second=[copy(original)];P.apply(first,[],{...original,post:''},{id:'S1',month:'2026-09',date:'2026-09-01'});P.apply(second,[],{...original,shift:'C'},{id:'S1',month:'2026-10',date:'2026-10-01'});
  await Promise.all([P.persist(first,[]),P.persist(second,[])]);const stored=await P.read();assert.equal(P.snapshot(stored.db[0],'2026-09').post,'');assert.equal(P.snapshot(stored.db[0],'2026-10').shift,'C');assert.equal(P.snapshot(stored.db[0],'2026-08').shift,'A');
  const newer=copy(first);P.apply(newer,[],{...original,status:'resigned'},{id:'S1',month:'2026-09',date:'2026-09-14'});const merged=w.SEC.mergeRecords('personnel',newer,[copy(original)]).records;assert.equal(P.list(merged,'2026-09').length,0);
  console.log('PASS: effective-month add/edit/resign, prior-month names/IDs/photos/hours, future versions, duplicate and legend rejection, archived hours, annual totals and cross-device version merge');
  // Exercise the actual modal with a delayed save and duplicate click.
  let commits=0,release;const mask=P.openEditor({month:'2026-09',onSave:async(input,opt)=>{commits++;assert.equal(input.name,'Modal Guard');assert.equal(opt.month,'2026-09');await new Promise(r=>release=r);return true;}});
  mask.querySelector('[data-person-field="name"]').value='Modal Guard';const save=mask.querySelector('[data-save]');const p=save.onclick();await save.onclick();assert.equal(commits,1);release();await p;assert(!mask.isConnected);
  const bad=P.openEditor({month:'2026-09',onSave:async()=>{throw Error('Simulated cloud failure');}});await bad.querySelector('[data-save]').onclick();assert.match(bad.querySelector('[data-error]').textContent,/cloud failure/);assert(!bad.querySelector('[data-save]').disabled);bad.remove();
  // Real importer, including repeated workbook and a past-month import after a resignation.
  await w.SEC.dbPut('ac_sec_personnel_db',[copy(original)]);await w.SEC.dbPut('ac_sec_personnel_chg',[]);w.ATT={};w.ATT_LOG=[];w.ATT_INFO={};
  const sheets=[{name:'2026-08',fileName:'Attendance 2026-08.xlsx',rows:[['Day Shift 2026-08'],['ID','Name',...Array.from({length:31},(_,i)=>i+1)],['A001','Original Guard','W','R'],['A002','New Guard','W','W'],['','Red= Dayoff A'],['','Green= take Leave A']]}];
  let imported;w.SEC.pickExcel=cb=>{imported=cb(copy(sheets));};w.impExcel();await imported;let x=await P.read();assert.equal(x.db.length,2);assert.equal(w.ATT_LOG.length,4);assert.equal(Object.keys(w.ATT['2026-08']).length,2);const count=x.changes.length;
  w.impExcel();await imported;x=await P.read();assert.equal(x.db.length,2);assert.equal(x.changes.length,count);assert.equal(w.ATT_LOG.length,4);
  const old=x.db.find(r=>r.id==='S1');P.apply(x.db,x.changes,{...P.snapshot(old,'2026-09'),status:'resigned'},{id:old.id,month:'2026-09',date:'2026-09-14'});await P.persist(x.db,x.changes);w.impExcel();await imported;x=await P.read();assert.equal(P.snapshot(x.db.find(r=>r.id==='S1'),'2026-09').status,'resigned');
  let uploaded=[];w.SEC.cloudPush=async(tool,rows)=>{uploaded.push({tool,rows:copy(rows)});return true;};await w.doUpload();assert.deepEqual(uploaded.map(x=>x.tool),['personnel','attendance']);assert.equal(uploaded[1].rows.filter(r=>r.month).length,2);
  console.log('PASS: roster modal save/retry/double-click, real Excel importer repeated twice, legends excluded, old-month reimport after departure and dual-module upload');
 }finally{page.dom.window.close();}
 const personnel=await load('ac_sec_personnel_v1.html'),v=personnel.w,Q=v.SEC.Personnel;assert.deepEqual(personnel.errors,[]);
 try{
  v.SEC.scheduleAutoCloudSync=()=>{};v.PER=month(v,'2026-09');v.DB=[copy(original),{...copy(original),id:'S90',empId:'90',name:'Never Changed'}];v.CHG=[];
  const joined=Q.apply(v.DB,v.CHG,{empId:'2',name:'Joined September',shift:'B',photo:'join-photo'},{month:'2026-09',date:'2026-09-14'});
  const left=Q.apply(v.DB,v.CHG,{...original,status:'resigned'},{id:'S1',month:'2026-09',date:'2026-09-14'});
  Q.apply(v.DB,v.CHG,{empId:'3',name:'Joined October',shift:'B'},{month:'2026-10',date:'2026-10-01'});
  await v.save();v.renderAll();
  for(const details of [false,true]){const defs=v.personnelChangeDefs({...state,includeDetails:details}),text=defs.map(d=>d.text).join('\n');assert.match(text,/Personnel changes/);assert.match(text,/Joined September/);assert.match(text,/Original Guard/);assert(!text.includes('Never Changed'));assert(!text.includes('Joined October'));assert.equal(defs.flatMap(d=>d.photos).includes('join-photo'),details);}
  assert.equal(v.personnelChanges(state).length,2);
  v.SEC.gasPost=async()=>({sent:false});await assert.rejects(Q.notify(joined.change),/Not delivered|did not deliver|未送達/);assert(Q.unsent((await Q.read()).changes.find(r=>r.id===joined.change.id)));
  v.SEC.gasPost=async()=>({sent:true});await Q.notify(joined.change);let data=await Q.read();assert(!Q.unsent(data.changes.find(r=>r.id===joined.change.id)));v.DB=data.db;v.CHG=data.changes;
  assert.equal(v.personnelChanges(state).length,1);assert.equal(v.personnelChanges({...state,scope:'allChanges'}).length,2);
  // Only mark the exact version actually delivered.
  const before=Q.signature(left.change);left.change.reason='Changed after preview';await Q.persist(v.DB,[left.change]);await Q.markSent([{id:left.change.id,signature:before}]);assert(Q.unsent((await Q.read()).changes.find(r=>r.id===left.change.id)));
  data=await Q.read();v.DB=data.db;v.CHG=data.changes;v.SEC.setCfg({gasUrl:'https://offline.test/gas'});let posted=[],delivery=false;
  v.doUpload=async()=>true;v.fetch=async(url,opt)=>{posted.push(JSON.parse(opt.body));return {ok:true,text:async()=>JSON.stringify({ok:true,data:{sent:delivery,sentPages:1}})};};
  v.openPersonnelTelegram();const button=v.document.querySelector('#tgSend');assert(!button.disabled);await button.onclick();assert(Q.unsent((await Q.read()).changes.find(r=>r.id===left.change.id)),'failed monthly batch stays pending');
  delivery=true;await button.onclick();data=await Q.read();assert(!Q.unsent(data.changes.find(r=>r.id===left.change.id)));
  const sent=posted.filter(p=>p.action==='telegramBatch').at(-1);assert(sent);const payload=JSON.stringify(sent.pages);assert(!payload.includes('Never Changed'));assert(!payload.includes('Joined October'));assert(!payload.includes('Joined September'),'previously sent individual change excluded');
  v.DB=data.db;v.CHG=data.changes;v.openPersonnelTelegram();assert(v.document.querySelector('#tgSend').disabled,'nothing pending disables send');
  const scope=v.document.querySelector('#tgScope');scope.value='allChanges';scope.onchange();assert(!v.document.querySelector('#tgSend').disabled);assert(!v.document.querySelector('#tgPreview').textContent.includes('Never Changed'));
  console.log('PASS: changes-only monthly pages/photos, pending vs all-changes scope, individual/batch failed-delivery retry, exact-version receipts and empty-send guard');
 }finally{personnel.dom.window.close();}
 // Backend: concurrent commits must merge snapshots even when both clients began from the same manifest.
 {
  const r=runtime('2026-09-14T02:00:00Z'),c=r.c,env=(data,at)=>({__secReplace:true,updatedAt:at,data});
  const base={...copy(original),_attKey:'A001',_k:'staff',_rosterHistory:{'0000-01':env({...original,exists:true},'1970-01-01T00:00:00Z')}};
  const a={...copy(base),updatedAt:'2026-09-14T01:00:00Z'},b={...copy(base),updatedAt:'2026-09-14T02:00:00Z'};
  a._rosterHistory['2026-09']=env({...original,exists:true,status:'resigned',photo:''},a.updatedAt);b._rosterHistory['2026-10']=env({...original,exists:true,post:'Future post'},b.updatedAt);
  const key='m:2026-06';function stage(id,rows){c.secSmartBucketPost_({tool:'personnel',uploadId:id,bucket:key,records:rows});return {tool:'personnel',uploadId:id,hashes:{[key]:'test-'+id},counts:{[key]:rows.length},recordCount:rows.length};}
  const bodyA=stage('a',[a]),bodyB=stage('b',[b]);c.secSmartCommitPost_(bodyA);c.secSmartCommitPost_(bodyB);
  let result=c.secSmartBucketGet_('personnel',key).records;assert.equal(result.length,1);assert(result[0]._rosterHistory['2026-09']);assert(result[0]._rosterHistory['2026-10']);assert.equal(result[0]._rosterHistory['2026-09'].data.photo,'');
  c.secSmartCommitPost_(stage('stale',[base]));result=c.secSmartBucketGet_('personnel',key).records;assert.equal(result[0]._rosterHistory['2026-09'].data.status,'resigned');
  // A stale client with no staged bucket must retain the latest committed bucket.
  c.secSmartCommitPost_({tool:'personnel',uploadId:'nothing',hashes:{[key]:'obsolete'}});assert(c.secSmartBucketGet_('personnel',key).records[0]._rosterHistory['2026-10']);
  const event={changeId:'PC1',kind:'join',date:'2026-09-14',empId:'2',name:'New person'};c.tgSend=()=>null;assert(!c.handlePersonnelChange(event).sent);assert(!c.tgSummaryFind_(c.tgDigest_(JSON.stringify([]))));let delivered=0;c.tgSend=()=>({message_id:++delivered});assert(c.handlePersonnelChange(event).sent);assert(c.handlePersonnelChange(event).skippedDuplicate);assert.equal(delivered,1);assert(c.handlePersonnelChange({...event,reason:'Changed detail'}).sent);assert.equal(delivered,2);
  console.log('PASS: backend concurrent/stale personnel commits, retained month versions and blank photo, individual notice failed-send retry and deduplication');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
