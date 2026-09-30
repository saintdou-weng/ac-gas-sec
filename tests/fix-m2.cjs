/* Container + Fire fixes: numbering, edit-state reset, double-click guard, validation,
   photo storage, time parsing (real .xlsx), back-dated inspections, QR pages
   (offline draft + retry, explicit result, no prompt), single-language UI/Telegram/Excel.
   jsdom part always runs; the Chromium 390x844 part runs when playwright is available. */
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {load:loadPage}=require('./dom-harness.cjs');
const vm=require('vm'),{JSDOM,VirtualConsole}=require('jsdom');
/* Same as dom-harness load(), but keeps a ?query so QR scan pages can be opened. */
async function load(nameWithQuery){
 const [name,query]=nameWithQuery.split('?');if(!query)return loadPage(name);
 const root=path.join(__dirname,'..'),errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented: (HTMLCanvasElement|navigation)/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(fs.readFileSync(path.join(root,name),'utf8'),{url:'https://offline.test/'+name+'?'+query,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.confirm=()=>true;w.alert=()=>{};w.fetch=async()=>{throw Error('Network disabled in regression tests');};
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({measureText:()=>({width:20}),canvas:{width:800,height:300}},{get:(o,k)=>k in o?o[k]:()=>{}});
 w.Chart=class{constructor(){this.data={};this.options={}}destroy(){}update(){}resize(){}};w.Chart.register=()=>{};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}};
 w.addEventListener('error',e=>errors.push(e.error&&e.error.stack||e.message));
 for(const script of w.document.querySelectorAll('script')){
  if(script.src){const url=new URL(script.src);if(url.hostname==='offline.test'){const file=path.join(root,url.pathname);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),dom.getInternalVMContext(),{filename:url.pathname});}}
  else try{vm.runInContext(script.textContent,dom.getInternalVMContext(),{filename:name});}catch(e){errors.push(e.stack);}
 }
 await new Promise(r=>setTimeout(r,30));return {dom,w,errors};
}
const CJK=/[㐀-鿿豈-﫿]/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const copy=x=>JSON.parse(JSON.stringify(x));
function pass(m){console.log('PASS: '+m);}
function cjkVisible(w,root){
  const d=w.document,out=[];root=root||d.body;
  const hidden=el=>{for(let n=el;n&&n!==d.documentElement;n=n.parentElement){if(n.style&&n.style.display==='none')return true;if(n.hidden)return true;
    if(n.classList&&n.classList.contains('mask')&&!n.classList.contains('on'))return true;
    if(n.matches&&n.matches('.lang-sw,.qr-lang,.cloud-bar,.hdr-right,#tgPreview,script,style,#secBootError,#toastwrap'))return true;}return false;};
  const tw=d.createTreeWalker(root,4);let n;
  while((n=tw.nextNode())){if(CJK.test(n.nodeValue)&&!hidden(n.parentElement))out.push(n.nodeValue.trim().slice(0,80));}
  root.querySelectorAll('[placeholder],[title]').forEach(el=>{if(hidden(el))return;['placeholder','title'].forEach(a=>{const v=el.getAttribute(a);if(v&&CJK.test(v))out.push('@'+a+':'+v);});});
  return out;
}
function exportCapture(w){const cap=[];w.SEC.exportExcel=(sheets)=>{cap.push(copy(sheets));};return cap;}
function exportCJK(cap){const bad=[];cap.forEach(sheets=>sheets.forEach(s=>{if(CJK.test(s.name))bad.push('sheet:'+s.name);(s.rows||[]).forEach(r=>Object.keys(r).forEach(k=>{if(CJK.test(k))bad.push('hdr:'+k);if(typeof r[k]==='string'&&CJK.test(r[k]))bad.push('cell:'+r[k]);}));}));return bad;}
function mockFetch(w,handler){const calls=[];w.fetch=async(url,opt)=>{const body=JSON.parse(opt.body);calls.push(body);const data=await handler(body);return {ok:true,text:async()=>JSON.stringify({ok:true,data})};};w.SEC.setCfg({gasUrl:'https://offline.test/gas'});return calls;}
function offline(w){w.fetch=async()=>{throw new TypeError('Failed to fetch');};}

(async()=>{
 /* ═════════ CONTAINER ═════════ */
 {
  const p=await load('ac_sec_container_v2.html'),w=p.w,d=w.document;
  try{
   assert.deepEqual(p.errors,[]);
   w.SEC.scheduleAutoCloudSync=()=>{};let tg=0;w.SEC.tgSummary=async()=>{tg++;return true;};
   // #17 gate-pass numbering: max+1, never count+1; new docs never overwrite.
   w.GD=[];w.gdType('gp');
   const mk=(dept,item)=>{d.getElementById('gd_date').value=w.SEC.ymd();d.getElementById('gd_dept').value=dept;d.querySelector('#gdItems .itemrow input').value=item;w.gdSave();};
   mk('D1','chair');mk('D2','table');mk('D3','fan');
   const pre='GP-'+w.SEC.ymd().replace(/-/g,'')+'-';
   assert.deepEqual(w.GD.map(r=>r.no).sort(),[pre+'01',pre+'02',pre+'03']);
   w.gdDel(w.GD.find(r=>r.dept==='D2').id);assert.equal(d.getElementById('gd_no').value,pre+'04','deleted number is never reused');
   mk('D4','computer');
   assert.deepEqual(w.GD.map(r=>r.no+':'+r.dept).sort(),[pre+'01:D1',pre+'03:D3',pre+'04:D4'],'GP-03 was not overwritten');
   // #18 edit then abandon via tab switch -> next new save must not overwrite.
   const d3=w.GD.find(r=>r.dept==='D3');w.editGd(d3.id);assert.equal(w.GD_EDIT,d3.id);assert.equal(d.getElementById('gdEditBanner').hidden,false,'editing banner shown');
   assert.equal(d.getElementById('gd_no').value,d3.no);
   d.querySelector('.tabs[data-tabs="gate"] .tab[data-p="gd-rec"]').click();
   assert.equal(w.GD_EDIT,'','tab switch clears edit state');assert.equal(d.getElementById('gdEditBanner').hidden,true);
   d.querySelector('.tabs[data-tabs="gate"] .tab[data-p="gd-new"]').click();mk('D5','desk');
   assert.equal(w.GD.length,4);assert.equal(w.GD.find(r=>r.id===d3.id).dept,'D3','abandoned edit target untouched');
   w.editGd(d3.id);w.gdCancelEdit();assert.equal(w.GD_EDIT,'');
   w.editGd(d3.id);d.getElementById('gd_dept').value='D3-edited';w.gdSave();assert.equal(w.GD.length,4);assert.equal(w.GD.find(r=>r.id===d3.id).dept,'D3-edited','real edit updates in place');
   // Validation: no items -> nothing saved, field highlighted.
   const n0=w.GD.length;d.querySelector('#gdItems .itemrow input').value='';w.gdSave();assert.equal(w.GD.length,n0);assert(d.querySelector('#gdItems .invalid'),'item field highlighted');
   pass('container gate pass numbering max+1, no overwrite after delete/abandoned edit, cancel-edit, required items');

   // Inspection edit state + validation.
   d.querySelector('.sb[data-m="insp"]').click();
   d.getElementById('ci_cno').value='';w.ciSave();assert.equal(w.CI.length,0);assert(d.getElementById('ci_cno').classList.contains('invalid'));
   d.getElementById('ci_cno').value='MSCU1234567';d.getElementById('ci_by').value='Dara';w.ciSave();assert.equal(w.CI.length,1);
   const ci=w.CI[0];assert.deepEqual(copy(ci.fails),[]);
   w.editCi(ci.id);assert.equal(w.CI_EDIT,ci.id);assert.equal(d.getElementById('ciEditBanner').hidden,false);
   d.querySelector('.sb[data-m="truck"]').click();assert.equal(w.CI_EDIT,'','module switch clears inspection edit');
   d.querySelector('.sb[data-m="insp"]').click();
   w.confirm=()=>false;d.getElementById('ci_cno').value='MSCU1234567';w.ciToggle(d.querySelector('#ciChecks [data-c="floor"]'));w.ciSave();
   assert.equal(w.CI.length,1);assert.equal(w.CI[0].pass,17,'declined overwrite of same container/day leaves record unchanged');
   w.confirm=()=>true;w.ciSave();assert.equal(w.CI.length,1);assert.deepEqual(copy(w.CI[0].fails),['floor']);
   pass('container inspection required fields, edit banner, edit cleared on module switch, same-day overwrite asks first');

   // Truck: new modal, double-click guard, retry after Telegram failure, photo storage.
   d.querySelector('.sb[data-m="truck"]').click();
   w.TK=[];w.tkAdd();assert.equal(d.getElementById('tkDelBtn').style.display,'none','new record has no Delete');
   assert.match(d.getElementById('t_timeIn').value,/^\d{2}:\d{2}$/);assert.equal(d.getElementById('t_timeIn').type,'time');
   d.getElementById('t_containerNo').value='';await w.tkSaveEdit();assert.equal(w.TK.length,0);assert(d.getElementById('t_containerNo').classList.contains('invalid'));
   let sends=0,fail=true;w.sendTruckLiveUpdate=async(o,phase)=>{sends++;await sleep(40);if(fail)throw new Error('Telegram down');o.tgMessageId='m1';return {sent:true,messageId:'m1'};};
   d.getElementById('t_containerNo').value='MSCU1';d.getElementById('t_notifyMode').value='live';w.TK_ENTRY_PHOTOS=['entry-a'];w.TK_EXIT_PHOTOS=['exit-b'];
   const a=w.tkSaveEdit();await sleep(2);const b=w.tkSaveEdit();await Promise.all([a,b]);
   assert.equal(w.TK.length,1,'double click creates one record');assert.equal(sends,1,'double click sends once');
   assert.equal(w.TK_EDIT,w.TK[0].id,'after first save a retry targets the same record');assert(d.getElementById('mTk').classList.contains('on'),'modal stays open for retry');
   fail=false;await w.tkSaveEdit();assert.equal(w.TK.length,1,'retry updates instead of duplicating');assert.equal(sends,2);assert.equal(w.TK_EDIT,'','closing clears edit state');
   const t=w.TK[0];assert.deepEqual(copy(t.entryPhotos),['entry-a']);assert.deepEqual(copy(t.exitPhotos),['exit-b']);assert.equal('photos' in t,false,'no third combined photo copy');
   w.TK.push({id:'LEG',date:w.SEC.ymd(),containerNo:'OLD1',photos:['p1','p2'],exitPhotos:['p2']});
   assert.deepEqual(copy(w.truckEntryPhotos(w.TK[1])),['p1']);assert.deepEqual(copy(w.truckAllPhotos(w.TK[1])),['p1','p2']);
   w.tkAdd('LEG');assert.deepEqual(copy(w.TK_ENTRY_PHOTOS),['p1']);assert.equal(d.getElementById('tkDelBtn').style.display,'');w.tkClose();assert.equal(w.TK_EDIT,'');
   pass('container truck: no Delete on new, time-in defaults to now (type=time), validation, double-click guard, failed Telegram retry updates same record, entry/exit photos without duplicate copy');

   // Time parsing (cellDates:false) incl. a real SheetJS workbook through the importer.
   assert.equal(w.fmtT(0.3541666667),'08:30');assert.equal(w.fmtT(46266.5),'12:00');assert.equal(w.fmtT('8:30 PM'),'20:30');assert.equal(w.fmtT('not out'),'not out');
   const X=w.XLSX,aoa=[['NO.','DATE','NAME','Driver Licence','Container Number','Truck Number','Container Company','Import','Export','VISITOR ID','TIME IN','SIGN','TIME OUT','SIGN','REMARK'],
     ['序','日期','姓名','','貨櫃號','車牌','公司','進口','出口','','入廠','','出廠','',''],['ល','កាលបរិច្ឆេទ','ឈ្មោះ','','','','','','','','','','','',''],
     [1,46266,'Sok','L1','XLSU7777777','3A-1111','Maersk','P','','V1',0.3541666667,'Guard A',0.7083333333,'Guard B','']];
   const ws=X.utils.aoa_to_sheet(aoa);ws['B4'].z='yyyy-mm-dd';ws['K4'].z='hh:mm';ws['M4'].z='hh:mm';
   const wb=X.utils.book_new();X.utils.book_append_sheet(wb,ws,'Sep');const buf=X.write(wb,{type:'array',bookType:'xlsx'});
   const file=new w.File([buf],'truck.xlsx');const sheets=await new Promise(r=>w.SEC.readWorkbook(file,r));
   w.SEC.pickExcel=cb=>cb(sheets);w.tkImp();const imp=w.TK.find(r=>r.containerNo==='XLSU7777777');
   assert(imp,'imported');assert.equal(imp.date,'2026-09-01');assert.equal(imp.timeIn,'08:30');assert.equal(imp.timeOut,'17:00');assert.equal(imp.isImport,true);
   pass('container time parsing: Excel fractions/serials/AM-PM, real .xlsx import gives 2026-09-01 08:30-17:00');

   // Single-language UI, Telegram and Excel in en/km; re-render on language change.
   w.TK=[{id:'T1',date:w.SEC.ymd(),name:'Sok',containerNo:'MSCU1',truckNo:'3A',company:'Maersk',isImport:true,timeIn:'08:00',timeOut:'09:00',entryPhotos:['e1'],exitPhotos:[]}];
   w.CI=[{id:'C1',date:w.SEC.ymd(),containerNo:'MSCU1',by:'Dara',pass:15,result:'fail',fails:['前牆 Front wall','floor','qr'],checks:{},items:[{name:'Shirts',qty:'10',unit:'box'}]}];
   w.GD=[{id:'G1',type:'gp',no:'GP-1',date:w.SEC.ymd(),time:'10:00',dept:'HR',by:'Dara',reasons:['sample','repair'],items:[{name:'Chair',qty:'1',unit:'pc'}]},{id:'G2',type:'dn',no:'DN-1',date:w.SEC.ymd(),reasons:['fg'],items:[{name:'Box',qty:'2'}],_deleted:true}];
   for(const lang of ['en','km']){
    w.SEC.setLang(lang);
    for(const mod of ['truck','insp','gate']){
     d.querySelector('.sb[data-m="'+mod+'"]').click();
     for(const tab of d.querySelectorAll('.tabs[data-tabs="'+mod+'"] .tab')){tab.click();assert.deepEqual(cjkVisible(w),[],lang+' '+mod+' '+tab.dataset.p);}
    }
    d.querySelector('.sb[data-m="truck"]').click();w.tkAdd('T1');assert.deepEqual(cjkVisible(w),[],lang+' truck modal');w.tkClose();
    assert.equal(d.querySelector('.hdr-t1').textContent,lang==='en'?'Container In/Out':'ចេញចូលកុងតឺន័រ');
    for(const details of [false,true]){
     const defs=w.containerSummaryPageDefs({ptype:'month',period:w.PER.key(),lang,includeDetails:details});
     defs.forEach(x=>assert(!CJK.test(x.text),lang+' telegram: '+x.text));
    }
    const s=w.containerSummary({ptype:'month',period:w.PER.key(),lang,includeDetails:false});assert(/: 1\b/.test(s));
    assert(!/: 2\b/.test(s.split('\n').find(l=>/Gate|លិខិតចេញ \//.test(l))||''),'deleted pass not counted');
    const cap=exportCapture(w);w.tkExp();w.ciExp();w.gdExp();assert.deepEqual(exportCJK(cap),[],lang+' excel');
    assert.equal(cap[2][0].rows.length,1,'excel excludes _deleted');
   }
   w.SEC.setLang('zh');assert.equal(d.querySelector('.hdr-t1').textContent,'貨櫃出入');
   pass('container en/km: every module/tab/modal, Telegram pages, Excel headers+cells single-language; deleted rows excluded; zh restored on switch');
  }finally{p.dom.window.close();}
 }

 /* ═════════ CONTAINER QR (offline draft + retry, no prompt, explicit result, trilingual) ═════════ */
 {
  const p=await load('ac_sec_container_v2.html?qr=container&mode=insp&token=TOK1&ptype=month&period=');const w=p.w,d=w.document;
  try{
   await sleep(60);
   assert.deepEqual(p.errors,[],'no window.prompt / script errors');
   const root=d.getElementById('qrContainerRoot');assert(root,'QR root');assert(d.getElementById('qci_by'),'form rendered while offline');
   assert(root.textContent.includes('📴'),'offline notice shown');
   assert(d.getElementById('qci_date').value===w.SEC.ymd());
   assert.equal(d.querySelectorAll('#qci_result .qr-choice.on').length,0,'no default result');
   d.getElementById('qci_cno').value='MSCU9';d.getElementById('qci_by').value='Dara';
   offline(w);await w.qrContainerSubmit();assert(d.getElementById('qci_result').classList.contains('invalid'),'result must be chosen');
   d.querySelector('#qci_result .qr-choice[data-v="fail"]').click();
   await w.qrContainerSubmit();assert(w.localStorage.getItem('ac_sec_qr_draft_container_TOK1'),'draft kept on phone');assert(d.getElementById('qrContRetry'),'retry button');
   const calls=mockFetch(w,b=>({updated:0,added:1,noticeSent:true}));d.getElementById('qrContRetry').click();await sleep(20);
   const push=calls.find(c=>c.action==='qrPush');assert(push);assert.equal(push.records[0].result,'fail');assert.deepEqual(copy(push.records[0].fails),['qr']);assert.equal(push.operator,'Dara');
   assert.equal(w.localStorage.getItem('ac_sec_qr_draft_container_TOK1'),null,'draft cleared after upload');
   for(const lang of ['en','km']){w.SEC.setLang(lang);assert.deepEqual(cjkVisible(w,root),[],'container QR '+lang);}
   pass('container QR: no name prompt, offline form + local draft + Retry, explicit Pass/Fail, en/km without Chinese');
  }finally{p.dom.window.close();}
  const q=await load('ac_sec_container_v2.html?qr=container&mode=truck&token=TOK2');const v=q.w,e=v.document;
  try{
   await sleep(60);assert.deepEqual(q.errors,[]);
   assert.equal(e.getElementById('qct_in').type,'time');assert.match(e.getElementById('qct_in').value,/^\d{2}:\d{2}$/);assert(e.getElementById('qct_ie'),'import/export field');
   e.getElementById('qct_cno').value='TRK1';e.getElementById('qct_by').value='Sok';
   const calls=mockFetch(v,b=>({updated:0,added:1}));await v.qrContainerSubmit();assert.equal(calls.filter(c=>c.action==='qrPush').length,0,'direction required');
   e.getElementById('qct_ie').value='exp';await v.qrContainerSubmit();const push=calls.find(c=>c.action==='qrPush');
   assert(push&&push.records[0].isExport===true&&push.records[0].isImport===false);assert.equal('photos' in push.records[0],false);
   pass('container truck QR: Import/Export required, time pickers default to now');
  }finally{q.dom.window.close();}
 }

 /* ═════════ FIRE ═════════ */
 {
  const p=await load('ac_sec_fire_v1.html'),w=p.w,d=w.document;
  try{
   assert.deepEqual(p.errors,[]);await sleep(30);
   assert(!/inventory updated|消防設備已更新|ធ្វើបច្ចុប្បន្នភាពឧបករណ៍/i.test(d.getElementById('toastwrap').textContent),'no automatic inventory toast on load');
   w.SEC.scheduleAutoCloudSync=()=>{};
   const E=(id,code,last)=>({id,code,type:'ext',factory:'a',zone:'bldA',loc:'Loc '+code,status:'ok',last,inspector:'Old'});
   w.DB=[E('E1','FE01','2026-09-20'),E('E2','FE02','2026-09-01')];w.HIST=[];w.PER=new w.SEC.Period('month',new w.Date(2026,8,15));
   d.querySelector('#tabs .tab[data-p="insp"]').click();
   assert.equal(d.querySelectorAll('#p-insp .fire-sticky-save [data-fire-save]').length,2,'sticky save bar');
   d.getElementById('cDate').value='2026-09-10';d.getElementById('cBy').value='Dara';
   w.INSP={E1:{r:'fault',n:'Low pressure'},E2:{r:'ok'}};w.paintFireInspCount();assert(/2/.test(d.getElementById('fireInspCount').textContent));
   w.saveInsp();w.saveInsp();
   assert.equal(w.HIST.length,1,'second click adds nothing');
   assert.equal(w.DB[0].last,'2026-09-20','back-dated fault does not move last backwards');assert.equal(w.DB[0].status,'ok');assert.equal(w.DB[0].inspector,'Old');
   assert.equal(w.DB[1].last,'2026-09-10','newer date updates last');assert.equal(w.DB[1].inspector,'Dara');
   assert.equal(w.HIST[0].bad,1);
   // Edit a batch, abandon via tab switch, new save creates a new batch.
   const hid=w.HIST[0].id;w.editFireHistory(hid);assert.equal(w.FIRE_HIST_EDIT_ID,hid);assert.equal(d.getElementById('fireHistEditBanner').hidden,false);
   d.querySelector('#tabs .tab[data-p="list"]').click();assert.equal(w.FIRE_HIST_EDIT_ID,'');assert.deepEqual(copy(w.INSP),{});
   d.querySelector('#tabs .tab[data-p="insp"]').click();d.getElementById('cDate').value='2026-09-12';d.getElementById('cBy').value='Sok';w.INSP={E2:{r:'ok'}};w.saveInsp();
   assert.equal(w.HIST.length,2,'abandoned edit does not overwrite old batch');assert.equal(w.HIST.find(h=>h.id===hid).n,2);
   w.editFireHistory(hid);w.fireCancelHistEdit();assert.equal(w.FIRE_HIST_EDIT_ID,'');assert.equal(d.getElementById('fireHistEditBanner').hidden,true);
   // Editing an old batch to an older date keeps the newer last-check.
   w.editFireHistory(hid);d.getElementById('cDate').value='2026-09-05';w.saveInsp();assert.equal(w.DB[1].last,'2026-09-12');assert.equal(w.HIST.length,2);
   w.quickCheck('E1');assert.equal(w.DB[0].last,w.SEC.ymd()>'2026-09-20'?w.SEC.ymd():'2026-09-20');
   w.openEdit();assert.equal(d.getElementById('eDelBtn').style.display,'none','no Delete in new-equipment modal');w.fireCloseEdit();
   pass('fire: no auto toast, sticky save bar, double-click safe, back-dated/edited inspections never move last backwards, edit state reset on tab/cancel, no Delete in new modal');

   w.HIST.push({id:'DEL',date:'2026-09-14',by:'X',items:[{...E('E1','FE01'),result:'fault'}],n:1,bad:1,ok:0,_deleted:true});
   const st={ptype:'month',period:'2026-09',scope:'all',includeDetails:true};
   assert(!w.fireInspectionRows(st).some(r=>r.date==='2026-09-14'),'deleted batch excluded from summaries');
   for(const lang of ['en','km']){
    w.SEC.setLang(lang);
    for(const tab of ['list','insp','ana']){d.querySelector('#tabs .tab[data-p="'+tab+'"]').click();assert.deepEqual(cjkVisible(w),[],'fire '+lang+' '+tab);}
    w.openEdit('E1');assert.deepEqual(cjkVisible(w),[],'fire '+lang+' edit modal');w.fireCloseEdit();
    for(const details of [false,true]){for(const defs of [w.fireEquipmentPageDefs({...st,lang,includeDetails:details}),w.fireInspectionPageDefs({...st,lang,includeDetails:details})])defs.forEach(x=>assert(!CJK.test(x.text),lang+' fire telegram: '+x.text.slice(0,200)));}
    w.fireScopeOptions().forEach(o=>assert(!CJK.test(o.label),o.label));
    const cap=exportCapture(w);w.expExcel();assert.deepEqual(exportCJK(cap),[],'fire excel '+lang);
    assert.equal(d.querySelector('.hdr-t1').textContent,lang==='en'?'Fire Equipment':'ឧបករណ៍ពន្លត់អគ្គិភ័យ');
   }
   w.SEC.setLang('zh');
   pass('fire en/km: list/inspection/analytics/modal, Telegram pages, scope options, Excel single-language; deleted history excluded');
  }finally{p.dom.window.close();}
 }

 /* ═════════ FIRE QR ═════════ */
 {
  const p=await load('ac_sec_fire_v1.html?qr=fire&mode=zone&zone=bldA&token=FTOK&ptype=month&period=');const w=p.w,d=w.document;
  try{
   await sleep(60);assert.deepEqual(p.errors,[],'no prompt / errors');
   const root=d.getElementById('qrFireRoot');assert(root.querySelector('#qrFireBody button'),'offline load shows a retry button');
   const today=w.SEC.ymd(),future='2099-01-01';
   const recs=Array.from({length:25},(_,i)=>({id:'Z'+i,code:'FE'+String(i+1).padStart(2,'0'),type:'ext',factory:'a',zone:'bldA',loc:'Point '+i,status:'ok',last:i===0?future:'2026-01-01',photos:['equip-photo']}));
   const calls=mockFetch(w,b=>b.action==='qrPull'?{records:recs,period:today.slice(0,7),periodType:'month',extra:{history:[]},meta:{expiresAt:Date.now()+864e5}}:{updated:(b.records||[]).length,added:0,noticeSent:true});
   await w.qrFireLoad();
   assert.equal(d.getElementById('qrFireDate').value,today,'date defaults to today');
   assert.equal(d.querySelectorAll('#qrFireRoot .insp-choice.on').length,0,'no default result');
   assert.equal(d.querySelectorAll('#qrFireRoot select.qr-result').length,0);
   d.getElementById('qrFireBy').value='Dara';
   await w.qrFireSubmit();assert.equal(calls.filter(c=>c.action==='qrPush').length,0,'nothing chosen -> nothing uploaded');assert(d.querySelector('#qrFireRoot .qr-eq.invalid'));
   d.querySelector('.qr-eq[data-id="Z1"] .insp-choice[data-r="fault"]').click();d.querySelector('.qr-eq[data-id="Z1"] .qr-note').value='Empty';
   let asked='';w.confirm=m=>{asked=m;return true;};
   offline(w);await w.qrFireSubmit();assert(/24/.test(asked),'asks before skipping unchecked items');
   assert(w.localStorage.getItem('ac_sec_qr_draft_fire_FTOK'));assert(d.getElementById('qrFireRetry'));
   mockFetch(w,b=>({updated:1,added:0}));const sent=[];const f0=w.fetch;w.fetch=async(u,o)=>{sent.push(JSON.parse(o.body));return f0(u,o);};
   d.getElementById('qrFireRetry').click();await sleep(20);
   assert.equal(sent.length,1);assert.equal(sent[0].records.length,1);assert.equal(sent[0].records[0].status,'fault');assert.equal(sent[0].records[0].last,today);
   assert.deepEqual(copy(sent[0].records[0].photos),['equip-photo'],'equipment photo kept when no new photo');
   assert.equal(sent[0].extra.history[0].items[0].result,'fault');assert.deepEqual(copy(sent[0].extra.history[0].items[0].photos),[]);
   assert.equal(w.localStorage.getItem('ac_sec_qr_draft_fire_FTOK'),null);
   // All normal: 25 items -> two batches (backend accepts 20 per call); back-dated item keeps its newer last.
   sent.length=0;w.qrFireAllOk();await w.qrFireSubmit();
   assert.equal(sent.length,2);assert.equal(sent[0].records.length,20);assert.equal(sent[1].records.length,5);assert(sent[0].extra.history&&!sent[1].extra.history,'history once');
   assert.equal(sent[0].records.find(r=>r.id==='Z0').last,future,'QR never moves last backwards');
   for(const lang of ['en','km']){w.SEC.setLang(lang);assert.deepEqual(cjkVisible(w,root),[],'fire QR '+lang);}
   pass('fire QR: today default, name field only (no prompt), explicit ✅/⛔, offline draft + Retry, 20-per-call batches, last never backwards, en/km without Chinese');
  }finally{p.dom.window.close();}
 }

 /* ═════════ Chromium 390x844 ═════════ */
 let pw=null;try{pw=require('playwright');}catch(e){}
 const exe=process.env.SEC_TEST_CHROMIUM||(fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')?'/opt/pw-browsers/chromium-1194/chrome-linux/chrome':undefined);
 if(!pw){console.log('SKIP: Chromium part (playwright not installed)');return;}
 const root=path.join(__dirname,'..'),shots=process.env.M2_SHOTS||'';
 const browser=await pw.chromium.launch({executablePath:exe,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
 try{
  for(const lang of ['zh','en','km']){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.addInitScript(l=>{try{localStorage.setItem('ac_sec_config',JSON.stringify({lang:l,operator:'',route:'review'}));}catch(e){}window.__prompts=0;window.prompt=function(){window.__prompts++;return null;};},lang);
   let online=true;
   await ctx.route('**/*',async route=>{const u=new URL(route.request().url());
    if(u.hostname==='offline.test'){const f=path.join(root,decodeURIComponent(u.pathname));if(fs.existsSync(f)&&fs.statSync(f).isFile())return route.fulfill({status:200,contentType:f.endsWith('.html')?'text/html; charset=utf-8':f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(f)});return route.fulfill({status:404,body:''});}
    if(/script\.google\.com/.test(u.hostname)){if(!online)return route.abort();const b=JSON.parse(route.request().postData()||'{}');
      const data=b.action==='qrPull'?(b.tool==='fire'?{records:[{id:'Q1',code:'FE01',type:'ext',factory:'a',zone:'bldA',loc:'Gate',status:'ok',last:'2026-01-01'},{id:'Q2',code:'FE02',type:'ext',factory:'a',zone:'bldA',loc:'Kitchen',status:'ok',last:'2026-01-01'}],period:new Date().toISOString().slice(0,7),periodType:'month',extra:{history:[]},meta:{}}:{records:[],meta:{}}):{updated:1,added:0,noticeSent:true};
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})});}
    if(/cdnjs/.test(u.hostname))return route.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{constructor(){}destroy(){}update(){}};'});
    return route.abort();});
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const scan=async()=>page.evaluate(()=>{const CJK=/[㐀-鿿豈-﫿]/,out=[];const vis=el=>{if(!el.getClientRects().length)return false;const s=getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none';};
     const tw=document.createTreeWalker(document.body,4);let n;while((n=tw.nextNode())){const el=n.parentElement;if(!el||!CJK.test(n.nodeValue))continue;if(el.closest('.lang-sw,.qr-lang,.cloud-bar,.hdr-right,#tgPreview,script,style,#toastwrap'))continue;if(el.tagName==='OPTION'){const s=el.closest('select');if(s&&vis(s))out.push(n.nodeValue.trim());continue;}if(vis(el))out.push(n.nodeValue.trim());}
     document.querySelectorAll('[placeholder]').forEach(el=>{if(vis(el)&&CJK.test(el.placeholder))out.push('@ph:'+el.placeholder);});return out;});
   const overflow=async()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   const shot=async name=>{if(shots)await page.screenshot({path:path.join(shots,name+'-'+lang+'.png'),fullPage:false});};
   // Container main page
   await page.goto('https://offline.test/ac_sec_container_v2.html');await page.waitForTimeout(500);
   if(lang!=='zh')assert.deepEqual(await scan(),[],'chromium container '+lang);
   assert.equal(await overflow(),false,'container no horizontal overflow '+lang);await shot('container');
   await page.click('.sb[data-m="gate"]');await page.waitForTimeout(150);
   await page.click('[data-gd-save]');await page.waitForTimeout(150);
   assert.equal(await page.evaluate(()=>GD.length),0,'empty gate pass not saved');assert(await page.evaluate(()=>!!document.querySelector('#gdItems .invalid')));
   if(lang!=='zh')assert.deepEqual(await scan(),[],'container gate '+lang);await shot('container-gate');
   await page.click('.sb[data-m="truck"]');await page.click('#p-tk-board .btn.sm >> nth=0');await page.waitForTimeout(150);
   assert.equal(await page.isVisible('#tkDelBtn'),false,'no delete on new truck');if(lang!=='zh')assert.deepEqual(await scan(),[],'truck modal '+lang);await shot('container-truck-modal');
   await page.fill('#t_containerNo','MSCU5');await page.selectOption('#t_notifyMode','none');await page.dblclick('#tkSaveBtn');await page.waitForTimeout(250);
   assert.equal(await page.evaluate(()=>TK.length),1,'real double-click one truck record');
   // Container QR (online then offline retry)
   await page.goto('https://offline.test/ac_sec_container_v2.html?qr=container&mode=insp&token=CT1');await page.waitForTimeout(500);
   assert.equal(await page.evaluate(()=>window.__prompts),0,'no prompt');if(lang!=='zh')assert.deepEqual(await scan(),[],'container QR '+lang);
   assert.equal(await overflow(),false);await shot('container-qr');
   await page.fill('#qci_cno','MSCU8');await page.fill('#qci_by','Dara');await page.click('#qci_result .qr-choice.ok');
   online=false;await page.click('#qrContSubmitBtn');await page.waitForTimeout(300);
   assert(await page.isVisible('#qrContRetry'),'retry after offline submit');if(lang!=='zh')assert.deepEqual(await scan(),[],'container QR offline '+lang);await shot('container-qr-offline');
   online=true;await page.click('#qrContRetry');await page.waitForTimeout(300);assert.equal(await page.isVisible('#qrContRetry'),false,'retry succeeded');
   // Fire main page: inspection tab + sticky save
   await page.goto('https://offline.test/ac_sec_fire_v1.html');await page.waitForTimeout(700);
   await page.click('#tabs .tab[data-p="insp"]');await page.waitForTimeout(250);
   if(lang!=='zh')assert.deepEqual(await scan(),[],'fire insp '+lang);assert.equal(await overflow(),false,'fire no overflow '+lang);
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight/2));await page.waitForTimeout(100);
   const bar=await page.evaluate(()=>{const r=document.querySelector('.fire-sticky-save').getBoundingClientRect();return {top:r.top,bottom:r.bottom,h:innerHeight};});
   assert(bar.bottom<=bar.h+1&&bar.top>bar.h-140,'save bar sticks to the bottom while scrolling ('+JSON.stringify(bar)+')');await shot('fire-insp');
   // Fire QR: prompt-free, today default, explicit choice, offline retry
   await page.goto('https://offline.test/ac_sec_fire_v1.html?qr=fire&mode=zone&zone=bldA&token=FT1');await page.waitForTimeout(600);
   assert.equal(await page.evaluate(()=>window.__prompts),0);assert.equal(await page.inputValue('#qrFireDate'),await page.evaluate(()=>SEC.ymd()));
   if(lang!=='zh')assert.deepEqual(await scan(),[],'fire QR '+lang);assert.equal(await overflow(),false,'fire QR overflow '+lang);await shot('fire-qr');
   await page.fill('#qrFireBy','Dara');await page.click('.qr-eq[data-id="Q1"] .insp-choice.ok');await page.click('.qr-eq[data-id="Q2"] .insp-choice.fault');
   online=false;await page.click('#qrFireSubmitBtn');await page.waitForTimeout(300);assert(await page.isVisible('#qrFireRetry'));if(lang!=='zh')assert.deepEqual(await scan(),[],'fire QR offline '+lang);await shot('fire-qr-offline');
   online=true;await page.click('#qrFireRetry');await page.waitForTimeout(300);assert.equal(await page.isVisible('#qrFireRetry'),false);
   assert.deepEqual(errors,[],'page errors '+lang);
   await ctx.close();
  }
  pass('Chromium 390x844 zh/en/km: container + fire main/QR pages, no Chinese in en/km, no horizontal overflow, real double-click, offline Retry, sticky save bar');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
