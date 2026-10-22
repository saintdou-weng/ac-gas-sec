// 2026-10-22 智慧匯入中心 × 保安出勤（照 tests/import-hub.cjs）。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：月曆式出勤表（自動判成 出勤／Excel，背景開出勤頁用它自己的 impExcel 匯入，上雲）→ 名冊沒有的人在背景匯入時自動建成歷史人員（不是在職）
// → 同檔再丟＝已匯入過、不勾選 → 重匯不重複 → 長格式（工號／姓名／日期／狀態）跨兩個月 → 「✈️ 發摘要」開出勤頁並預選期間
// 出勤頁：⇧ 開視窗直接在本頁匯入（不開 iframe）；📝 產生報告下載 .docx（標題中英、摘要、明細）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-att-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const days=n=>Array.from({length:n},(_,i)=>i+1);
/* 月曆式：No | ID | Name | 1…30，格內 W/R/L/A；表尾圖例列不是人 */
const codes=s=>s.split('');
const calRows=[['VRT Security Attendance · Day Shift · September 2026'],['Period','2026-09-01','2026-09-30'],['No','ID','Name',...days(30)],
 [1,'A001','Sok Dara',...codes('WWWWWRWWWWWWLWWWWWWRWWWWWWAWWW')],
 [2,'A099','Unknown Guy',...codes('WWWWWWWWWW')],
 ['','','Red= Dayoff A'],['','','Green= take Leave A']];
const calFile=path.join(tmp,'Attendance Day Shift Sep 2026.xlsx');fs.writeFileSync(calFile,xlsxBuf([{name:'Day Shift',rows:calRows}]));
/* 長格式：工號／姓名／日期／狀態，跨 9、10 月 */
const longRows=[['Attendance log'],['工號','姓名','日期','狀態'],['A002','Chan Vuthy','2026-09-28','W'],['A002','Chan Vuthy','2026-09-29','W'],['A002','Chan Vuthy','2026-09-30','Leave'],
 ['A002','Chan Vuthy','2026-10-01','W'],['A002','Chan Vuthy','2026-10-02','W'],['A001','Sok Dara','2026-10-01','Present'],['A001','Sok Dara','2026-10-02','Absent']];
const longFile=path.join(tmp,'Attendance log Sep-Oct 2026.xlsx');fs.writeFileSync(longFile,xlsxBuf([{name:'Log',rows:longRows}]));
/* 本頁 ⇧ 用：夜班 10 月，只有名冊上的人（不會跳未對應視窗） */
const nightRows=[['Night Shift Attendance October 2026'],['Period','2026-10-01','2026-10-31'],['No','ID','Name',...days(31)],[1,'A002','Chan Vuthy',...codes('WWWWWRWWWWWWWRWWWWWWRWWWWWWRWWW')]];
const nightFile=path.join(tmp,'Attendance Night Shift Oct 2026.xlsx');fs.writeFileSync(nightFile,xlsxBuf([{name:'Night Shift',rows:nightRows}]));
/* 名冊（人員模組的資料）：A001、A002 在職；A099 不在名冊 */
const roster=[{id:'S1',empId:'A001',name:'Sok Dara',position:'保安員 Security Guard',shift:'A',post:'Gate A',joinDate:'2026-08-01',status:'active',createdAt:'2026-08-01T01:00:00.000Z',updatedAt:'2026-08-01T01:00:00.000Z'},
 {id:'S2',empId:'A002',name:'Chan Vuthy',position:'保安員 Security Guard',shift:'C',post:'Gate B',joinDate:'2026-08-01',status:'active',createdAt:'2026-08-01T01:00:00.000Z',updatedAt:'2026-08-01T01:00:00.000Z'}];
(async()=>{
 const cloud=runtime(new Date().toISOString());
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 async function route(ctx){
  await ctx.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());
   if(u.hostname==='offline.test'){const p=path.join(root,decodeURIComponent(u.pathname));if(fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({status:200,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});return r.fulfill({status:404,body:''});}
   if(u.hostname==='script.google.com'){let out;if(req.method()==='POST')out=cloud.c.doPost({postData:{contents:req.postData()||'{}'}}).text;else out=cloud.c.doGet({parameter:Object.fromEntries(u.searchParams)}).text;return r.fulfill({status:200,contentType:'application/json',body:out});}
   return r.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{destroy(){} update(){}};'});});
 }
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});await route(ctx);const pg=await ctx.newPage(),errors=[],dialogs=[];
  pg.on('pageerror',e=>errors.push(e.message));pg.on('dialog',d=>{dialogs.push(d.message());d.accept();});
  await pg.goto('https://offline.test/index.html');await pg.waitForSelector('#homeHub [data-drop]');
  await pg.evaluate(r=>SEC.dbPut('ac_sec_personnel_db',r),roster);
  /* ① 月曆式出勤表 → 自動判斷 → 背景匯入 → 上雲 → 動作按鈕；名冊沒有的 A099 自動建成歷史人員 */
  await pg.setInputFiles('#homeHub [data-file]',[calFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'attendance',JSON.stringify(items));assert.equal(items[0].kind,'excel');assert.equal(items[0].state,'ready','auto-detected without asking: '+JSON.stringify(items[0].cands));assert(items[0].on);assert.equal(items[0].month,'2026-09');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'||it.state==='err'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg,log:it.log})));
  assert.equal(items[0].state,'ok',JSON.stringify(items));assert.match(items[0].msg,/已上雲|uploaded/,'waited for the attendance cloud sync: '+items[0].msg);
  assert.match(items[0].log,/歷史人員|historical/,'import log says the unknown person became historical: '+items[0].log);
  const att=await pg.evaluate(()=>SEC.dbGet('ac_sec_att_db',{}));
  assert(att['2026-09']&&att['2026-09'].A001,'attendance page importer wrote September for A001: '+JSON.stringify(Object.keys(att['2026-09']||{})));
  assert.equal(att['2026-09'].A001['01'],'W');assert.equal(att['2026-09'].A001['13'],'L');assert.equal(att['2026-09'].A001['27'],'A');
  assert(att['2026-09'].A099&&att['2026-09'].A099['10']==='W','unknown person attendance kept under its own key');
  const raw=await pg.evaluate(()=>SEC.dbGet('ac_sec_att_raw',[]));assert.equal(raw.filter(r=>r.empId==='A001').length,30,'raw punches for A001: '+raw.length);
  const people=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_db',[]));
  const unk=people.find(p=>p.name==='Unknown Guy');assert(unk,'unknown name created in the roster');assert.equal(unk.status,'resigned','home-page background import makes the unknown person historical, not active');
  assert.equal(people.find(p=>p.empId==='A001').status,'active');
  assert(Object.keys(cloud.disk).some(k=>/smart_attendance/.test(k)),'uploaded to the (fake) cloud: '+Object.keys(cloud.disk));
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  let acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/ac_sec_attendance_v2\.html\?tg=summary&ptype=month&period=2026-09$/.test(a[1])),'summary action for attendance 2026-09: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可/.test(a[0])),'attendance has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 不重複 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[calFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({state:it.state,on:it.on})));assert.equal(items[0].state,'done-before');assert(!items[0].on,'already imported → unticked');
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  assert.equal(await pg.evaluate(()=>HOME_HUB.items[0].state),'ok');
  const raw2=await pg.evaluate(()=>SEC.dbGet('ac_sec_att_raw',[]));assert.equal(raw2.length,raw.length,'re-import does not duplicate punches');
  const people2=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_db',[]));assert.equal(people2.length,people.length,'re-import does not duplicate the historical person');
  assert.equal(people2.filter(p=>p.name==='Unknown Guy').length,1);
  /* ③ 長格式跨兩個月 → 兩個月都寫入；動作按鈕帶最後一個月 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[longFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'attendance');assert.equal(items[0].kind,'excel');assert.equal(items[0].state,'ready','long layout auto-detected: '+JSON.stringify(items[0].cands));assert.equal(items[0].month,'2026-10');
  await pg.click('#homeHub [data-run]');await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({state:it.state,msg:it.msg,log:it.log})));assert.equal(items[0].state,'ok',JSON.stringify(items));
  const att3=await pg.evaluate(()=>SEC.dbGet('ac_sec_att_db',{}));
  assert.equal(att3['2026-09'].A002['30'],'L','September row from the long file');assert.equal(att3['2026-10'].A002['01'],'W');assert.equal(att3['2026-10'].A001['02'],'A','October rows from the long file');
  assert.equal(att3['2026-09'].A001['13'],'L','earlier import untouched');
  acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>x.getAttribute('href')));assert(acts.some(h=>/ac_sec_attendance_v2\.html\?tg=summary&ptype=month&period=2026-10$/.test(h)),'summary action for the last month: '+JSON.stringify(acts));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'hub-home-attendance.png'),fullPage:true});
  /* ④ 發摘要 → 出勤頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_attendance_v2.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/Sok Dara/.test(prev),'preview has imported data: '+prev.slice(0,300));
  await pg.click('.tg-mask [data-tg-close]');
  /* ⑤ 頁首 ⇧：本頁模組直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  await pg.setInputFiles('.hub-mask [data-file]',[nightFile]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  assert.deepEqual(await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>[it.tool,it.kind,it.state])),[['attendance','excel','ready']]);
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  assert.equal(await pg.locator('[data-att-unmatched]').count(),0,'no unmatched modal for people in the roster');
  assert.equal(await pg.evaluate(()=>ATT['2026-10'].A002['31']),'W','live page data updated');
  assert.equal(await pg.evaluate(()=>ATT['2026-10'].A002['01']),'W','existing October cell kept');
  await pg.click('.hub-mask [data-close]');
  /* ⑥ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'attendance',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  const pv=await pg.textContent('[data-preview]');assert(/保安出勤|Attendance/.test(pv)&&/Sok Dara|A001/.test(pv),'preview: '+pv.slice(0,200));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'report-modal-attendance.png'),fullPage:true});
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_attendance_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/保安出勤/.test(docText)&&/Attendance/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/Sok Dara/.test(docText)&&/A001/.test(docText),'detail rows in the Word');
  assert(/Man-days|出勤人日/.test(docText)&&/Active staff|在職人數/.test(docText),'KPI rows in the comparison table');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'attendance'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × attendance — calendar sheet auto-detected, background import via the page\'s own impExcel + cloud wait, unknown name becomes historical (not active), same content = already imported, re-import no duplicates, long layout spanning two months, "send summary" opens the Telegram modal with the period, header ⇧ imports live without the unmatched modal, Word report with summary/comparison/details, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
