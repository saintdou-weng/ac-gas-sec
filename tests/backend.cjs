const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../ac_sec.gs'),'utf8');
function runtime(initial='2026-09-05T01:15:00Z'){
 let clock=Date.parse(initial),locked=false;const props={},disk={},messages=[],writes=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const store={getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v);return store;},deleteProperty:k=>{delete props[k];return store;},getProperties:()=>({...props})};
 function formatDate(d,tz,fmt){const f=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));return fmt.replace(/yyyy|MM|dd|HH|H|mm|ss/g,k=>({yyyy:p.year,MM:p.month,dd:p.day,HH:p.hour,H:String(+p.hour),mm:p.minute,ss:p.second}[k]));}
 const ctx=vm.createContext({Date:Clock,console:{log(){},error(){}},PropertiesService:{getScriptProperties:()=>store},Utilities:{formatDate,sleep(){},getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},Charset:{UTF_8:'utf8'},computeDigest:(alg,str)=>Array.from(crypto.createHash(alg).update(str).digest()),base64EncodeWebSafe:arr=>Buffer.from(arr).toString('base64url')},LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},waitLock:()=>{if(locked)throw Error('busy');locked=true;},releaseLock:()=>{locked=false;}})},UrlFetchApp:{fetch(){throw Error('NO LIVE NETWORK IN TESTS');}},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}});
 vm.runInContext(source,ctx);
 ctx.loadDrive=name=>disk[name]||null;ctx.saveDrive=(name,text)=>{disk[name]=text;writes.push(name);};
 ctx.tgSend=(chat,text,keyboard)=>{messages.push({chat,text,keyboard});return {message_id:messages.length,chat:{id:'test'}};};
 ctx.tgEdit=()=>true;ctx.tgPhoto=()=>({message_id:99});ctx.answerCb=(id,text)=>{ctx.answer=text;};ctx.isApprover=()=>true;
 return {c:ctx,props,disk,messages,writes,setDate:s=>{clock=Date.parse(s);},setLocked:v=>{locked=v;}};
}
module.exports={runtime};
if(require.main===module){
const clean=x=>JSON.parse(JSON.stringify(x));
{
 const r=runtime(),c=r.c;
 c.monthlyCompleteness=ym=>({ym,cloudMissing:[],summaryMissing:[],approvalMissing:[],feeData:false});
 const index=[];
 for(const [tool,period,kind] of [['fire','2026-08-12','summary'],['cctv','2026-09-05','summary'],['container','2026-09-12','summary'],['patrol','2026-07-12','summary'],['commute','2026-08-14','approval'],['expense','2026-08','approval']]){
  const name='dispatch_pending_'+period.slice(0,7)+'_'+tool;index.push(name);r.props[name]=JSON.stringify({[period+'|'+kind]:{tool,period,kind,updateMs:100,reason:'record-save'}});
 }
 r.props.dispatch_pending_index=JSON.stringify(index);
 const pend=clean(c.monthlyPendingDispatch_('2026-08'));assert.equal(pend.length,3);assert.equal(pend.find(x=>x.tool==='commute').kind,'summary');
 for(const day of ['2026-09-01T02:00:00Z','2026-09-04T02:00:00Z','2026-09-05T00:00:00Z','2026-09-12T04:00:00Z','2026-09-30T04:00:00Z']){
  r.setDate(day);assert(!c.pendingDispatchReminderJob().sent);assert(!c.monthlyCompletenessJob().sent);assert(!c.測試待發提醒().sent);assert(!c.weeklyPatrolPhotoReminderJob().sent);assert(!c.dailyAnomalyJob().sent);
 }assert.equal(r.messages.length,0,'no same-day/current-month/daily/weekly nagging');
 r.setDate('2026-09-05T01:15:00Z');let nested;
 const send=c.tgSend;c.tgSend=(...args)=>{nested=c.pendingDispatchReminderJob();return send(...args);};
 assert(c.pendingDispatchReminderJob().sent);assert.equal(nested.reason,'in-flight');assert.equal(r.messages.length,1);assert(r.messages[0].text.includes('2026-08'));assert(!r.messages[0].text.includes('2026-09-12'));assert(r.messages[0].text.length<2000);
 assert.equal(c.monthlyCompletenessJob().reason,'already-sent');assert.equal(c.測試待發提醒().reason,'already-sent');
 // Later edits cannot re-open a month already reminded.
 const p=JSON.parse(r.props['dispatch_pending_2026-08_fire']);p['2026-08-12|summary'].updateMs=200;r.props['dispatch_pending_2026-08_fire']=JSON.stringify(p);
 assert(!c.pendingDispatchReminderJob().sent);assert.equal(r.messages.length,1);
 r.setDate('2026-10-05T01:15:00Z');assert(c.pendingDispatchReminderJob().sent);assert.equal(r.messages.length,2);
 const f=runtime();f.c.monthlyCompleteness=c.monthlyCompleteness;f.c.tgSend=()=>null;assert(!f.c.pendingDispatchReminderJob().sent);assert(!f.props['monthly_completeness_sent_2026-08']);assert(!f.props['monthly_reminder_inflight_2026-08']);f.c.tgSend=()=>({message_id:1});assert(f.c.pendingDispatchReminderJob().sent);
 const h=runtime('2026-07-05T01:15:00Z');h.c.monthlyCompleteness=c.monthlyCompleteness;assert(!h.c.pendingDispatchReminderJob().sent,'Sunday');assert.equal(h.c.monthlyReminderSchedule_().due,'2026-07-06');h.setDate('2026-07-06T01:15:00Z');assert(h.c.pendingDispatchReminderJob().sent);
 const hd=runtime();hd.props.EXTRA_HOLIDAY_DATES='2026-09-05';assert.equal(hd.c.monthlyReminderSchedule_().due,'2026-09-07');
 const yr=runtime('2027-01-05T01:15:00Z');assert.equal(yr.c.monthlyReminderSchedule_().ym,'2026-12');
 // Any successful same-period receipt closes a tracked report, even after edits.
 const rc=runtime();rc.c.markDispatchSent_('fire','2026-08','month','summary');rc.c.markDispatchUpdate_({tool:'fire',period:'2026-08-12',reason:'inspection-save',updateAt:Date.now()+1000});assert.equal(rc.c.monthlyPendingDispatch_('2026-08').length,0);
 console.log('PASS: monthly schedule, previous-month scope, Sunday/holiday rollover, concurrent/replayed triggers, failed-send retry and successful receipts');
}
{
 const r=runtime(),c=r.c,dispatch={key:'dispatch-1',id:'1',kind:'commute-vehicle',group:'vehicle',dept:'Vehicle dispatch',name:'Driver A',date:'2026-09-01'},bike={id:'2',kind:'commute-bike',group:'bike',dept:'Motorbike'},fee={key:'fee-1',id:'3',dept:'Security Fee',amount:100,date:'2026-09-01'};
 assert(c.approvalBatchAllowed('commute',[dispatch]));assert(c.approvalBatchAllowed('expense',[fee]));
 for(const kind of ['commute-bike','commute-gate','commute-late','commute-whatever'])assert(!c.approvalBatchAllowed('commute',[{kind}]));
 assert(!c.approvalBatchAllowed('commute',[dispatch,bike]));assert(!c.approvalBatchAllowed('commute',[{kind:'commute-bike',group:'vehicle'}]));assert(!c.approvalBatchAllowed('container',[dispatch]));assert(!c.approvalBatchAllowed('expense',[{dept:'Other'}]));
 for(const req of [{module:'container',items:[dispatch]},{module:'commute',items:[bike]},{module:'commute',items:[dispatch,bike]}]){
  assert.throws(()=>c.createApprovalBatch(req),/summary-only/);assert(!JSON.parse(c.doPost({postData:{contents:JSON.stringify({action:'approvalRequest',...req})}}).text).ok);
 }assert.equal(r.writes.length,0);assert.equal(r.messages.length,0);
 // An old review message must neither advance stages nor change ledger/data.
 const old={batchId:'OLD',module:'commute',period:'2026-09',route:'review',stage:'review',status:'open',audit:[],items:[{...bike,itemId:'2',status:'pending'}]};r.disk['batch_OLD.json']=JSON.stringify(old);r.props.tok_old='OLD#2';
 for(const data of ['ap:old:A','ap:old:T','ba:OLD','bc:OLD','bv:OLD','bp:OLD:1','bl:OLD:en','br:OLD']){
  const response=JSON.parse(c.handleCallback({id:'cq',data,message:{chat:{id:'test'},message_id:1},from:{id:'tester',first_name:'Tester'}}).text);assert.equal(response.data.reason,'approval-not-required');
 }
 assert.equal(c.applyDecision('old','A','tester','Tester').reason,'approval-not-required');assert.equal(c.approveAllPending('OLD','tester','Tester').reason,'approval-not-required');assert.equal(c.closeBatch('OLD','tester','Tester').reason,'approval-not-required');
 assert.throws(()=>c.resendApprovalBatch({batchId:'OLD'}),/not allowed/);assert.equal(c.sendBatchMessage(old),null);assert.equal(c.refreshBatchMessage(old),null);assert.equal(c.sendBatchResult(old),null);assert.equal(r.writes.length,0);assert.equal(r.messages.length,0);assert.equal(r.disk['batch_OLD.json'],JSON.stringify(old));
 const first=c.createApprovalBatch({module:'commute',period:'2026-09',items:[dispatch]});assert(first.messageId);const again=c.createApprovalBatch({module:'commute',period:'2026-09',items:[dispatch]});assert.equal(again.batchId,first.batchId);assert(again.reused);
 r.setDate('2026-09-05T01:15:01Z');const second=c.createApprovalBatch({module:'commute',period:'2026-09',items:[{...dispatch,key:'dispatch-2',id:'4'}]});assert.notEqual(second.batchId,first.batchId,'same count must not reuse another set of records');
 const allowed=c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee]});assert(allowed.messageId);
 const batch=JSON.parse(r.disk['batch_'+first.batchId+'.json']);assert(c.applyDecision(batch.items[0].token,'A','tester','Tester').ok,'legitimate vehicle approval works');
 console.log('PASS: API/direct/old-callback approval restrictions, unchanged history, legitimate dispatch and fee approval, identity-aware deduplication');
}
{
 const r=runtime(),c=r.c;let sends=0;c.tgSendLong=()=>{sends++;return {message_id:sends};};c.tgPhoto=()=>{sends++;return {message_id:sends};};
 const body={module:'fire',period:'2026-09',periodType:'month',mode:'summary',pages:[{text:'Overview'},{text:'FE001 · Pump room · fault',photos:['fault-photo']}]};
 const one=c.handleTgSummaryBatch_(body);assert(one.sent);const n=sends;assert(c.handleTgSummaryBatch_(body).skippedDuplicate);assert.equal(sends,n);
 c.handleTgSummaryBatch_({...body,period:'2026-10'});assert.equal(sends,n+3,'abnormal evidence remains attachable in another month');
 const count=sends;assert.throws(()=>c.handleTgSummaryBatch_({...body,pages:Array.from({length:25},()=>({text:'row'}))}),/24/);assert.equal(sends,count,'no silently dropped pages');
 console.log('PASS: fire text/photo delivery, same-report dedupe, monthly abnormal attachments and over-limit rejection before delivery');
}

}
