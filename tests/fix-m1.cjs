/* fix-m1：費用／通勤／人員三頁的修正回歸測試（jsdom + Chromium 390×844）。
   node tests/fix-m1.cjs   （Chromium 部分可用 SEC_TEST_CHROMIUM 指定執行檔；找不到 playwright 時略過並標示 SKIP） */
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {load}=require('./dom-harness.cjs');
const root=path.join(__dirname,'..');
const CJK=/[\u3400-\u9fff\uf900-\ufaff]/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const copy=x=>JSON.parse(JSON.stringify(x));
let failed=0;
async function step(name,fn){try{await fn();console.log('PASS: '+name);}catch(e){failed++;console.error('FAIL: '+name+'\n',e&&e.stack||e);}}
/* 掃描整頁可見文字、placeholder、title、option；語言切換鈕「繁中」本來就是中文 */
function leaks(w,rootEl){
  const d=w.document,out=[],r=rootEl||d.body;
  const tw=d.createTreeWalker(r,w.NodeFilter.SHOW_TEXT);let t;
  while((t=tw.nextNode())){const p=t.parentElement;if(!p||/^(SCRIPT|STYLE)$/.test(p.tagName)||p.closest('.lang-sw')||p.closest('#secBootError')||(p.closest('.mask')&&!p.closest('.mask').classList.contains('on')&&!rootEl))continue;if(CJK.test(t.nodeValue))out.push(t.nodeValue.trim().slice(0,80)+' @'+p.tagName+(p.id?'#'+p.id:''));}
  r.querySelectorAll('[placeholder],[title]').forEach(el=>{if(!rootEl&&el.closest('.mask')&&!el.closest('.mask').classList.contains('on'))return;['placeholder','title'].forEach(a=>{const v=el.getAttribute(a);if(v&&CJK.test(v))out.push('@'+a+' '+v);});});
  if(!rootEl&&CJK.test(d.title))out.push('title '+d.title);
  return out;
}
function setLang(w,l){w.SEC.setLang(l);const t=w.document.getElementById('toastwrap');if(t)t.innerHTML='';}
function clickTabs(w,fn){[...w.document.querySelectorAll('.tab')].forEach(t=>{t.click();fn&&fn(t.dataset.p);});}
function stubCommon(w,exports){
  w.SEC.scheduleAutoCloudSync=()=>{};w.SEC.startAutoCloudSync=()=>{};
  w.SEC.exportExcel=(sheets,fn)=>{exports.push({sheets:copy(sheets),fn});};
}
function exportCjk(exports){const bad=[];exports.forEach(x=>x.sheets.forEach(s=>s.rows.forEach(r=>Object.keys(r).forEach(k=>{if(CJK.test(k))bad.push('header '+k);if(typeof r[k]==='string'&&CJK.test(r[k]))bad.push('cell '+r[k]);}))));return bad;}
function xlsxFile(w,aoa,name){const XLSX=w.XLSX,wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),name||'Sheet1');const buf=XLSX.write(wb,{type:'array',bookType:'xlsx'});return new w.File([new Uint8Array(buf)],(name||'test')+'.xlsx');}
function readXlsx(w,file){return new Promise((res,rej)=>{try{w.SEC.readWorkbook(file,sheets=>res(sheets));}catch(e){rej(e);}});}

(async()=>{
/* ═════════════ 費用 ═════════════ */
{
 const p=await load('ac_sec_expense_v1.html'),w=p.w,d=w.document,exports=[];
 await step('expense page loads without errors',()=>assert.deepEqual(p.errors,[]));
 stubCommon(w,exports);w.SEC.setCfg({operator:'Tester',lang:'zh'});
 const set=o=>Object.entries(o).forEach(([k,v])=>{d.getElementById(k).value=v;});
 const add=(name,amt,date='2026-09-10',cat)=>{d.querySelector('.tab[data-p="new"]').click();set({nDate:date,nName:name,nVendor:'V',nQty:'',nPrice:'',nAmt:amt});if(cat)d.getElementById('nCat').value=cat;w.saveNew();return w.DB[w.DB.length-1];};
 w.PER=new w.SEC.Period('month',new w.Date(2026,8,10));
 await step('#16 code = max existing sequence +1 (incl. deleted), never DB.length+1',async()=>{
   w.DB=[];add('A',10);add('B',20);add('C',30);
   assert.deepEqual(w.DB.map(r=>r.code),['EXP-20260910-001','EXP-20260910-002','EXP-20260910-003']);
   w.delRec(w.DB[1].id);const D=add('D',40);assert.equal(D.code,'EXP-20260910-004');
   w.delRec(D.id);const E=add('E',50);assert.equal(E.code,'EXP-20260910-005','deleted max code is not reused');
   assert.equal(new Set(w.DB.map(r=>r.code)).size,w.DB.length);
   assert.equal(w.nextCode('SVC','202609'),'SVC-202609-001');w.DB.push({id:'x1',code:'SVC-202609-007',date:'2026-09-01'});assert.equal(w.nextCode('SVC','202609'),'SVC-202609-008');w.DB.pop();
 });
 await step('#16 approval items: key = record id, id = display code; status matched by record id only',async()=>{
   w.DB=[];w.BATCH=[];const fee='保安服務費 Security Service';
   const a=add('Guard fee A',100,'2026-09-10',fee),b=add('Guard fee B',200,'2026-09-10',fee);
   b.code=a.code; /* 舊資料可能已重號：核可 A 不可連帶 B */
   const items=w.targets().map(w.approvalItem);assert.equal(items.length,2);
   items.forEach(it=>{const r=w.DB.find(x=>x.id===it.key);assert(r,'key is record id');assert.equal(it.id,r.code);});
   let calls=0;w.SEC.sendApproval=async o=>{calls++;await sleep(30);return {batchId:'EXP-B1',count:o.items.length,route:'review'};};
   const p1=w.doSend(),p2=w.doSend();assert(d.getElementById('btnSend').disabled,'button disabled while sending');await Promise.all([p1,p2]);
   assert.equal(calls,1,'in-flight guard blocks double send');
   assert(w.DB.every(r=>r.batchId==='EXP-B1'&&r.apprStatus==='pending'),'batchId stored on sent records');
   w.SEC.gasPost=async o=>({status:'open',stage:'approve',counts:{},items:[{itemId:a.id,status:'approved'}]});
   await w.checkStatus();assert.equal(a.apprStatus,'approved');assert.equal(b.apprStatus,'pending','same display code is NOT approved');
   /* 舊批次（當時以編號當 key）只套用到仍屬於該批次的紀錄 */
   const c=add('Guard fee C',300,'2026-09-10',fee);c.batchId='OLD';c.apprStatus='pending';const other=add('Guard fee D',1,'2026-09-10',fee);other.code=c.code;
   w.BATCH.unshift({batchId:'OLD',status:'open'});w.SEC.gasPost=async o=>o.batchId==='OLD'?{status:'open',items:[{itemId:c.code,status:'rejected'}]}:{status:'open',items:[]};
   await w.checkStatus();assert.equal(c.apprStatus,'rejected');assert.equal(other.apprStatus,'','legacy code match limited to batch members');
 });
 await step('#20 editing approved/pending resets approval (trilingual confirm); rejected can be re-sent',async()=>{
   const a=w.DB.find(r=>r.apprStatus==='approved');let msg='';w.confirm=m=>{msg=m;return true;};
   w.editExpense(a.id);assert.equal(w.EXP_EDIT_ID,a.id);d.getElementById('nAmt').value='999';w.saveNew();
   assert.match(msg,/重新核可/);assert.equal(a.apprStatus,'');assert.equal(a.batchId,'');assert.equal(a.amount,999);
   const c=w.DB.find(r=>r.apprStatus==='rejected');assert(w.sendable(c),'rejected is sendable');
   assert(w.targets().some(r=>r.id===c.id));assert.equal(w.approvalItem(c).batchId,'','rejected item is not a resend of the closed batch');
   setLang(w,'en');w.editExpense(a.id);d.getElementById('nAmt').value='1000';a.batchId='B9';a.apprStatus='pending';w.saveNew();assert.match(msg,/re-approved/);assert(!CJK.test(msg));setLang(w,'zh');
 });
 await step('#18 edit state cleared on tab switch / cancel; banner shows code',async()=>{
   const a=w.DB[0];w.editExpense(a.id);assert.equal(d.getElementById('editBanner').style.display,'');assert.match(d.getElementById('editBannerText').textContent,new RegExp(a.code));
   d.querySelector('.tab[data-p="list"]').click();assert.equal(w.EXP_EDIT_ID,'');d.querySelector('.tab[data-p="new"]').click();assert.equal(d.getElementById('nName').value,'','form reset after abandoning edit');
   const n=w.DB.length;set({nDate:'2026-09-11',nName:'Brand new',nAmt:5});w.saveNew();assert.equal(w.DB.length,n+1,'new save creates a new record');assert.equal(a.name,w.DB[0].name);
   w.editExpense(a.id);w.cancelEdit();assert.equal(w.EXP_EDIT_ID,'');assert.equal(d.getElementById('editBanner').style.display,'none');
 });
 await step('required fields highlighted; amount auto = price × qty (readonly); date defaults to today',async()=>{
   d.querySelector('.tab[data-p="new"]').click();w.cancelEdit();assert.equal(d.getElementById('nDate').value,w.SEC.ymd());
   const n=w.DB.length;set({nName:'',nAmt:''});w.saveNew();assert.equal(w.DB.length,n);assert(d.getElementById('nName').classList.contains('bad'));assert(d.getElementById('nAmt').classList.contains('bad'));
   set({nQty:'3',nPrice:'2.5'});w.calcAmt();assert.equal(d.getElementById('nAmt').value,'7.50');assert(d.getElementById('nAmt').readOnly);
   set({nPrice:''});w.calcAmt();assert(!d.getElementById('nAmt').readOnly);
 });
 await step('send button disabled with explanation when nothing pending',async()=>{
   w.DB=[{id:'g1',code:'EXP-1',date:'2026-09-10',name:'Pens',cat:'耗材 Consumable',amount:3}];d.getElementById('aScope').value='period';w.renderAppr();
   assert(d.getElementById('btnSend').disabled);assert(d.getElementById('sendWhy').textContent.length>5);
 });
 await step('impFee year: inferred from sheet/file, closest year when missing (Jan importing Dec → previous year)',async()=>{
   assert.equal(w.feePeriod('December',{name:'Sheet1'},new w.Date(2027,0,15)),'2026-12');
   assert.equal(w.feePeriod('December',{name:'Sheet1'},new w.Date(2026,11,2)),'2026-12');
   assert.equal(w.feePeriod('October',{name:'x'},new w.Date(2026,8,29)),'2026-10');
   assert.equal(w.feePeriod('Sep-25',{name:'x'},new w.Date(2026,8,29)),'2025-09');
   assert.equal(w.feePeriod('AUGUST',{name:'fee 2025'},new w.Date(2026,8,29)),'2025-08');
   assert.equal(w.feePeriod(46266,{name:'x'}),'2026-09');
   assert.equal(w.feePeriod('',{name:'Sheet1',fileName:'security_service_fee_application.xlsx'}),'','no false month from file name');
   assert.equal(w.feePeriod('',{name:'Sheet1',fileName:'fee_2026-07.xlsx'}),'2026-07');
 });
 await step('impFee with a real .xlsx (cellDates:false): period, SVC codes, security fee rows, resend-safe',async()=>{
   const aoa=[['company','ICSC','','month','December'],['day',31],[],['day shift'],['no','name','location','per month','','','total hr','','total pay'],
     [1,'Guard One','Gate A',300,'','',240,'',310],[2,'Guard Two','Gate B',300,'','',240,'',305],['Night shift'],[1,'Guard Three','Gate A',320,'','',240,'',330],['','total','','','','','','',945]];
   const sheets=await readXlsx(w,xlsxFile(w,aoa,'Fee'));w.DB=[];
   const RealDate=w.Date;w.Date=class extends RealDate{constructor(...a){if(!a.length)super(2027,0,10,9,0,0);else super(...a);}static now(){return new RealDate(2027,0,10,9).getTime();}};
   try{w.SEC.pickExcel=cb=>cb(copy(sheets));w.impFee();}finally{w.Date=RealDate;}
   assert.equal(w.DB.length,3);assert(w.DB.every(r=>r.date==='2026-12-01'),'December imported in January → previous year');
   assert.deepEqual(w.DB.map(r=>r.code).sort(),['SVC-202612-001','SVC-202612-002','SVC-202612-003']);assert(w.DB.every(w.isSecurityFee));
   w.SEC.pickExcel=cb=>cb(copy(sheets));w.impFee();assert.equal(w.DB.length,3,'re-import does not duplicate');
 });
 await step('Telegram previews / exports: single language, exclude _deleted, totals match table',async()=>{
   w.DB=[{id:'a',code:'EXP-1',date:'2026-09-10',name:'保安服務費 Guard',cat:'保安服務費 Security Service',amount:100,unit:'人月',reason:'日班 Day · Gate',batchId:'',apprStatus:''},
         {id:'b',code:'EXP-2',date:'2026-09-11',name:'Radio',cat:'裝備 Equipment',amount:50},{id:'z',code:'EXP-3',date:'2026-09-12',name:'Gone',cat:'裝備 Equipment',amount:999,_deleted:true}];
   w.PER=new w.SEC.Period('month',new w.Date(2026,8,10));w.renderAll();
   assert.equal(d.getElementById('k2').textContent,'$150.00','deleted excluded from totals');
   for(const lang of ['en','km']){const st={ptype:'month',period:'2026-09',lang,includeDetails:true,scope:''};
     const txt=w.expenseSummaryPages(st).join('\n')+w.expenseApprovalPreview(st,w.expenseApprovalItems(st));
     assert(!CJK.test(txt),lang+' telegram text has CJK: '+(txt.match(/.{0,20}[\u3400-\u9fff].{0,20}/)||[''])[0]);assert.match(txt,/\$150\.00/);assert(!/999/.test(txt));}
   setLang(w,'en');exports.length=0;w.expExcel();assert.deepEqual(exportCjk(exports),[]);assert.equal(exports[0].sheets[0].rows.reduce((s,r)=>s+r.Amount,0),150);
   setLang(w,'zh');
 });
 await step('expense i18n: every tab in en/km has no Chinese; km uses correct date/period words',async()=>{
   for(const l of ['en','km']){setLang(w,l);let bad=[];clickTabs(w,()=>{bad=bad.concat(leaks(w));});w.editExpense(w.DB[0].id);bad=bad.concat(leaks(w));w.cancelEdit();assert.deepEqual([...new Set(bad)],[],l);}
   setLang(w,'km');assert.equal(d.querySelector('#p-list th[data-km="កាលបរិច្ឆេទ"]').textContent,'កាលបរិច្ឆេទ');assert(d.body.innerHTML.indexOf('ដំណាក់កាល')<0);setLang(w,'zh');
 });
 p.dom.window.close();
}

/* ═════════════ 通勤 ═════════════ */
{
 const p=await load('ac_sec_commute_v2.html'),w=p.w,d=w.document,exports=[];
 await step('commute page loads without errors',()=>assert.deepEqual(p.errors,[]));
 stubCommon(w,exports);w.SEC.setCfg({operator:'Gate Tester',lang:'zh'});
 w.PER=new w.SEC.Period('month',new w.Date(2026,8,10));
 await step('#9 time parsing after cellDates:false (fractions, serials, strings) incl. real .xlsx Come Late import',async()=>{
   assert.equal(w.fmtTime(0.3541666),'08:30');assert.equal(w.fmtTime(46266.75),'18:00');assert.equal(w.fmtTime('8:05 PM'),'20:05');assert.equal(w.fmtTime(''),'');
   assert.equal(w.localParseTime(0.3541666),'08:30');assert.equal(w.localParseTime(46266.354166),'08:30');assert.equal(w.localParseTime('7:15 am'),'07:15');
   const aoa=[['Come Late Register'],['DATE','COMPANY ID','NAME','DPT','TIME IN','TIME OUT','SECURITY','OTHER'],[46266,'1001','Worker A','Sewing',0.3541666666,0.75,'Guard X',''],[46267.0,'1002','Worker B','Cutting',46267.3333333,'', 'Guard Y','late bus']];
   const sheets=await readXlsx(w,xlsxFile(w,aoa,'Late'));w.LATE=[];w.SEC.pickExcel=cb=>cb(copy(sheets));w.impLate();
   assert.equal(w.LATE.length,2);const a=w.LATE.find(r=>r.empId==='1001'),b=w.LATE.find(r=>r.empId==='1002');
   assert.equal(a.date,'2026-09-01');assert.equal(a.checkIn,'08:30');assert.equal(a.checkOut,'18:00');assert.equal(b.date,'2026-09-02');assert.equal(b.checkIn,'08:00');
 });
 await step('#25 approval: sent records carry batch/key; status query matches by key/record id and shows badge',async()=>{
   w.CAR=[{id:'C1',_k:'car',date:'2026-09-10',driver:'Driver A',plate:'2A-1',type:'local',category:'local',reason:'Bank',outTime:'08:00',inTime:'10:00',km:12,approver:'Paul'},
          {id:'C2',_k:'car',date:'2026-09-10',driver:'Driver B',plate:'2A-2',type:'local',category:'local',reason:'Bank',outTime:'08:00',inTime:'10:00',km:12,approver:'Paul'},
          {id:'C3',_k:'car',date:'2026-09-11',driver:'Driver A',plate:'2A-1',type:'long',category:'long',reason:'PP',outTime:'07:00',inTime:'19:00',km:230,approver:'Paul'}];
   const st={ptype:'month',period:'2026-09',scope:'vehicle',lang:'en'};const items=w.commuteApprovalItems(st);assert.equal(items.length,2);
   const g=items.find(x=>x._recordIds.length===2);assert.deepEqual(copy(g._recordIds),['C1','C2']);assert(/^commute-vehicle-group-VG-/.test(g.key));
   w.commuteApprovalSent({batchId:'COM-1'},st,items);assert(w.CAR.every(r=>r.approvalBatch==='COM-1'&&r.approvalStatus==='pending'&&r.approvalKey));
   let queried=[];w.SEC.gasPost=async o=>{queried.push(o.batchId);await sleep(10);return {status:'open',items:[{itemId:g.key,status:'approved'},{itemId:items.find(x=>x!==g).key,status:'rejected'}]};};
   await Promise.all([w.checkCommuteStatus(),w.checkCommuteStatus()]);assert.deepEqual(queried,['COM-1'],'status query guarded against double click');
   assert.equal(w.CAR.find(r=>r.id==='C1').approvalStatus,'approved');assert.equal(w.CAR.find(r=>r.id==='C2').approvalStatus,'approved');assert.equal(w.CAR.find(r=>r.id==='C3').approvalStatus,'rejected');
   w.renderCar();assert.match(d.getElementById('tbCar').innerHTML,/tag ok/);assert.match(d.getElementById('tbCar').innerHTML,/tag err/);
   /* 舊紀錄沒有 approvalKey：以同批次成員重算群組 key */
   w.CAR.forEach(r=>{r.approvalKey='';r.approvalStatus='pending';r.approvalBatch='COM-OLD';});
   const n=w.applyCommuteStatus('COM-OLD',{items:[{itemId:g.key,status:'approved'}]});assert.equal(n,2);assert.equal(w.CAR.find(r=>r.id==='C3').approvalStatus,'pending');
   /* 被退件的可重送；已核可的不再列入 */
   w.CAR.find(r=>r.id==='C3').approvalStatus='rejected';const again=w.commuteApprovalItems(st);assert.equal(again.length,1);assert.deepEqual(copy(again[0]._recordIds),['C3']);assert.equal(again[0].batchId,'');
 });
 await step('#20 editing a dispatched record clears approval after confirm; unchanged edit keeps it',async()=>{
   const r=w.CAR.find(x=>x.id==='C1');r.approvalBatch='COM-1';r.approvalStatus='approved';r.approvalKey='k';let msg='';w.confirm=m=>{msg=m;return true;};
   w.editCar('C1');assert.equal(w.COMMUTE_EDIT_ID,'C1');assert.equal(d.getElementById('mEditBanner').style.display,'');w.saveAdd();
   assert.equal(r.approvalStatus,'approved','no business change → keep approval');
   w.editCar('C1');d.getElementById('m_km').value='99';w.saveAdd();assert.match(msg,/重新核可/);assert.equal(r.km,99);assert.equal(r.approvalBatch,'');assert.equal(r.approvalStatus,'');assert.equal(w.COMMUTE_EDIT_ID,'');
   /* 取消／切分頁都會清除編輯狀態 */
   w.editCar('C1');w.closeAdd();assert.equal(w.COMMUTE_EDIT_ID,'');w.editCar('C1');d.querySelector('.tab[data-p="late"]').click();assert.equal(w.COMMUTE_EDIT_ID,'');
   /* 匯入更新已核可派車 → 內容改變即重設 */
   const q=w.CAR.find(x=>x.id==='C3');q.approvalBatch='COM-1';q.approvalStatus='approved';
   assert.equal(w.commuteImportUpsert('car',{date:q.date,driver:q.driver,plate:q.plate,outTime:q.outTime,km:231,reason:'PP'}),'updated');assert.equal(q.approvalStatus,'');
 });
 await step('late registration: gate defaults to operator/last used, times default to now, labelled delete with confirm',async()=>{
   w.localStorage.removeItem('ac_sec_commute_last_gate');w.openAdd('late');const row=d.querySelector('#lateRows .late-row');
   assert.equal(row.querySelector('.late-gate').value,'Gate Tester');assert.equal(row.querySelector('.late-date').value,w.SEC.ymd());assert.match(row.querySelector('.late-checkIn').value,/^\d\d:\d\d$/);
   w.saveAdd();assert(row.querySelector('.late-name').classList.contains('bad'),'required name/ID highlighted');
   row.querySelector('.late-name').value='Worker Z';row.querySelector('.late-gate').value='Guard Last';const n=w.LATE.length;w.saveAdd();assert.equal(w.LATE.length,n+1);
   w.openAdd('late');assert.equal(d.querySelector('#lateRows .late-gate').value,'Guard Last','last used gatekeeper remembered');w.closeAdd();
   w.renderLate();const btn=[...d.querySelectorAll('#tbLate button')].find(b=>/刪除/.test(b.textContent));assert(btn,'labelled delete button');
   const id=btn.getAttribute('onclick').match(/del\('late','([^']+)'\)/)[1];let asked='';w.confirm=m=>{asked=m;return false;};w.del('late',id);assert.match(asked,/Worker Z/);assert.equal(w.LATE.length,n+1,'cancel keeps record');
   w.confirm=()=>true;w.del('late',id);assert.equal(w.LATE.length,n);
   w.openAdd('car');assert.match(d.getElementById('m_outTime').value,/^\d\d:\d\d$/);assert.equal(d.getElementById('m_date').value,w.SEC.ymd());w.closeAdd();
 });
 await step('#14 images: JPEG ≤480px only, no PNG references, fleet master lazy, stored PNG paths migrated',async()=>{
   const files=fs.readdirSync(path.join(root,'assets/commute'));assert(files.every(f=>/\.jpg$/.test(f)),files.join());
   files.forEach(f=>assert(fs.statSync(path.join(root,'assets/commute',f)).size<80000,f+' too large'));
   const html=fs.readFileSync(path.join(root,'ac_sec_commute_v2.html'),'utf8');assert(!/assets\/commute\/[^'"]+\.png/.test(html));
   (html.match(/assets\/commute\/[\w.]+/g)||[]).forEach(ref=>assert(fs.existsSync(path.join(root,ref)),ref+' missing'));
   const img=d.getElementById('fleetMaster');assert(!img.getAttribute('src'),'not loaded before modal opens');w.openDriverManager();assert.match(img.getAttribute('src'),/company_car_master\.jpg$/);w.SEC.closeModal('mDrivers');
   w.DRIVER_PROFILES=[{name:'Old Driver',photo:'./assets/commute/sey_sarun.png',carPhoto:'./assets/commute/mao_tola_car.png'}];w.cleanDriverMaster();
   assert.equal(w.DRIVER_PROFILES[0].photo,'./assets/commute/sey_sarun.jpg');assert.equal(w.DRIVER_PROFILES[0].carPhoto,'./assets/commute/mao_tola_car.jpg');
 });
 await step('commute Telegram/exports single-language, exclude _deleted',async()=>{
   w.CAR.push({id:'CX',_k:'car',date:'2026-09-12',driver:'Ghost',km:500,_deleted:true});
   w.BIKE=[{id:'B1',date:'2026-09-10',a:10,b:5,total:15}];w.GATE=[{id:'G1',date:'2026-09-10',plate:'3A',driver:'Driver A',pax:3,km:5}];
   for(const lang of ['en','km'])for(const scope of ['all','vehicle','bike','gate','late']){const st={ptype:'month',period:'2026-09',scope,lang,includeDetails:true};
     const txt=w.commuteSummaryPages(st).join('\n')+(scope==='vehicle'?w.commuteApprovalPreview(st,w.commuteApprovalItems(st)):'');assert(!CJK.test(txt),lang+'/'+scope+': '+(txt.match(/.{0,20}[\u3400-\u9fff].{0,20}/)||[''])[0]);assert(!/Ghost/.test(txt));}
   setLang(w,'en');exports.length=0;w.expExcel();assert.deepEqual(exportCjk(exports),[]);assert(!JSON.stringify(exports).includes('Ghost'));setLang(w,'zh');
 });
 await step('commute i18n: tabs, add/edit modals, driver list in en/km have no Chinese',async()=>{
   for(const l of ['en','km']){setLang(w,l);let bad=[];clickTabs(w,()=>{bad=bad.concat(leaks(w));});
     for(const k of ['car','bike','gate','late']){w.openAdd(k);bad=bad.concat(leaks(w,d.getElementById('mAdd')));w.closeAdd();}
     w.editCar('C3');bad=bad.concat(leaks(w,d.getElementById('mAdd')));w.closeAdd();
     w.openDriverManager();bad=bad.concat(leaks(w,d.getElementById('mDrivers')));w.SEC.closeModal('mDrivers');
     assert.deepEqual([...new Set(bad)],[],l);}
   setLang(w,'zh');
 });
 p.dom.window.close();
}

/* ═════════════ 人員 ═════════════ */
{
 const p=await load('ac_sec_personnel_v1.html'),w=p.w,d=w.document,exports=[];
 await step('personnel page loads without errors',()=>assert.deepEqual(p.errors,[]));
 stubCommon(w,exports);w.SEC.setCfg({operator:'HR',lang:'zh'});w.PER=new w.SEC.Period('month',new w.Date(2026,8,10));
 await step('empty state explains how to add / import (single language)',async()=>{
   w.DB=[];w.CHG=[];w.renderAll();assert.match(d.getElementById('tbRos').textContent,/新增人員/);
   setLang(w,'en');assert.match(d.getElementById('tbRos').textContent,/Add person/);assert(!CJK.test(d.getElementById('tbRos').textContent));setLang(w,'zh');
 });
 await step('perText / KIND support km; change tables and Telegram single-language',async()=>{
   assert.equal(w.perText('km','中','EN','ខ្មែរ'),'ខ្មែរ');assert.equal(w.perText('km','中','EN'),'EN');assert.equal(w.perText('zh','中','EN','ខ្មែរ'),'中');
   Object.keys(w.KIND).forEach(k=>assert(w.KIND[k].km&&!CJK.test(w.KIND[k].km),k));
   const P=w.SEC.Personnel;w.DB=[];w.CHG=[];
   P.apply(w.DB,w.CHG,{empId:'1',name:'Guard One',shift:'A',post:'Gate',position:'保安員 Security Guard',status:'active'},{month:'2026-09',date:'2026-09-02',kind:'join',reason:'Excel import / Excel 匯入'});
   P.apply(w.DB,w.CHG,{...P.snapshot(w.DB[0],'2026-09'),shift:'C'},{id:w.DB[0].id,month:'2026-09',date:'2026-09-15',kind:'shift',reason:'Roster cleared / 移出本月名冊'});
   for(const lang of ['en','km']){const st={ptype:'month',period:'2026-09',scope:'allChanges',lang,includeDetails:true};
     const txt=w.personnelSummaryPages(st).join('\n')+w.personnelRosterSummaryPages(st).join('\n');assert(!CJK.test(txt),lang+': '+(txt.match(/.{0,20}[\u3400-\u9fff].{0,20}/)||[''])[0]);}
   const km=w.personnelChangeDefs({ptype:'month',period:'2026-09',scope:'allChanges',lang:'km'})[0].text;assert.match(km,/ការផ្លាស់ប្តូរបុគ្គលិក/);
   setLang(w,'en');w.renderAll();exports.length=0;w.expExcel();w.expChange();assert.deepEqual(exportCjk(exports),[]);setLang(w,'zh');
 });
 await step('EDIT_CHANGE_ID reset on tab switch / cancel, banner shown while editing',async()=>{
   const c=w.CHG[0];w.editChange(c.id);assert.equal(w.EDIT_CHANGE_ID,c.id);assert.equal(d.getElementById('chgEditBanner').style.display,'');
   d.querySelector('.tab[data-p="ros"]').click();assert.equal(w.EDIT_CHANGE_ID,'');assert.equal(d.getElementById('cName').value,'');
   w.editChange(c.id);w.clearChangeForm();assert.equal(w.EDIT_CHANGE_ID,'');assert.equal(d.getElementById('chgEditBanner').style.display,'none');
 });
 await step('required fields marked and validated with highlight (no save when missing)',async()=>{
   assert(d.querySelector('label.req[data-zh="姓名"]'));assert(d.querySelector('label.req[data-zh="生效日"]'));
   let applied=0;const orig=w.SEC.Personnel.apply;w.SEC.Personnel.apply=function(){applied++;return orig.apply(this,arguments);};
   w.clearChangeForm();d.getElementById('cName').value='';await w.submitChange(true);assert.equal(applied,0);assert(d.getElementById('cName').classList.contains('bad'));
   w.SEC.Personnel.apply=orig;
 });
 await step('personnel i18n: every tab in en/km has no Chinese',async()=>{
   for(const l of ['en','km']){setLang(w,l);let bad=[];clickTabs(w,()=>{bad=bad.concat(leaks(w));});assert.deepEqual([...new Set(bad)],[],l);}
   setLang(w,'zh');
 });
 p.dom.window.close();
}

/* ═════════════ Chromium 390×844 ═════════════ */
let chromium=null;try{chromium=require('playwright').chromium;}catch(e){try{chromium=require('playwright-core').chromium;}catch(_){}}
if(!chromium){console.log('SKIP: Chromium (playwright not installed)');}
else{
 const exe=process.env.SEC_TEST_CHROMIUM||['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(f=>fs.existsSync(f));
 const browser=await chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
 try{
  for(const pg of ['ac_sec_expense_v1.html','ac_sec_commute_v2.html','ac_sec_personnel_v1.html'])for(const lang of ['zh','en','km']){
   await step('Chromium 390x844 '+pg+' '+lang+': tabs/modals clickable, no errors, no overflow'+(lang==='zh'?'':', no Chinese'),async()=>{
    const ctx=await browser.newContext({viewport:{width:390,height:844}});
    await ctx.addInitScript(l=>{localStorage.setItem('ac_sec_config',JSON.stringify({lang:l,operator:'Tester'}));window.confirm=()=>false;window.prompt=()=>null;},lang);
    await ctx.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='offline.test'){const f=path.join(root,decodeURIComponent(u.pathname));
      if(fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.jpg')?'image/jpeg':'application/octet-stream',body:fs.readFileSync(f)});return route.fulfill({status:404,body:''});}
      if(/cdnjs/.test(u.hostname))return route.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{constructor(){}destroy(){}update(){}};'});return route.abort();});
    const page=await ctx.newPage(),errors=[],imgs=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/assets\/commute/.test(r.url()))imgs.push(r.url());});
    await page.goto('https://offline.test/'+pg);await page.waitForTimeout(700);
    const tabs=await page.$$('.tabs .tab');let bad=[];
    for(const t of tabs){await t.click();await page.waitForTimeout(120);
      const r=await page.evaluate(()=>{const CJK=/[\u3400-\u9fff\uf900-\ufaff]/,out=[];const vis=el=>el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
        const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=tw.nextNode())){const p=n.parentElement;if(!p||/^(SCRIPT|STYLE)$/.test(p.tagName)||p.closest('.lang-sw'))continue;if(CJK.test(n.nodeValue)&&vis(p))out.push(n.nodeValue.trim().slice(0,60));}
        document.querySelectorAll('input[placeholder],select').forEach(el=>{if(!vis(el))return;if(CJK.test(el.getAttribute('placeholder')||''))out.push('@ph '+el.getAttribute('placeholder'));if(el.tagName==='SELECT')[...el.options].forEach(o=>{if(CJK.test(o.text))out.push('@opt '+o.text);});});
        return {out,overflow:document.documentElement.scrollWidth>innerWidth+1};});
      bad=bad.concat(r.out);assert(!r.overflow,'horizontal overflow on tab '+(await t.textContent()));}
    if(pg==='ac_sec_commute_v2.html'){
      assert(!imgs.some(u=>/company_car_master/.test(u)),'fleet master loaded before modal');
      for(const k of ['car','late','gate','bike']){await page.evaluate(k=>openAdd(k),k);await page.waitForTimeout(100);const vis=await page.isVisible('#mAdd .modal');assert(vis);await page.click('#btnSaveAdd');await page.waitForTimeout(80);await page.evaluate(()=>closeAdd());}
      await page.evaluate(()=>openDriverManager());assert.match(await page.getAttribute('#fleetMaster','src'),/company_car_master\.jpg$/);await page.evaluate(()=>document.getElementById('fleetMaster').scrollIntoView());await page.waitForTimeout(400);assert(imgs.some(u=>/company_car_master\.jpg/.test(u)),'fleet master loads on open');
      assert(await page.evaluate(()=>{const i=document.getElementById('fleetMaster');return i.complete&&i.naturalWidth>0&&i.naturalWidth<=480;}),'fleet master decoded, ≤480px');
      bad=bad.concat(await page.evaluate(()=>{const CJK=/[\u3400-\u9fff]/;return [...document.querySelectorAll('#mDrivers .modal *')].filter(e=>e.children.length===0&&CJK.test(e.textContent)).map(e=>e.textContent.slice(0,40));}));
    }
    if(pg==='ac_sec_expense_v1.html'){await page.click('.tab[data-p="new"]');await page.fill('#nName','Radio');await page.fill('#nAmt','12');await page.dblclick('#btnSave');await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>DB.length),1,'double-click creates exactly one record');await page.click('.tab[data-p="appr"]');assert(await page.isDisabled('#btnSend'));}
    if(pg==='ac_sec_personnel_v1.html'){await page.click('.tab[data-p="chg"]');await page.click('#btnChgSave');await page.waitForTimeout(80);assert(await page.evaluate(()=>document.getElementById('cName').classList.contains('bad')));}
    if(lang!=='zh')assert.deepEqual([...new Set(bad)],[]);
    assert.deepEqual(errors,[]);await ctx.close();
   });
  }
 }finally{await browser.close();}
}
if(failed){console.error(failed+' check(s) failed');process.exit(1);}
console.log('PASS: fix-m1 all checks');
})().catch(e=>{console.error(e);process.exit(1);});
