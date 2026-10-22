// 2026-10-22 智慧匯入中心 × 貨櫃出入（ac_sec_container_v2.html）。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟貨櫃車登記表 xlsx（中英柬三層標題、進出口 P 判定）→ 判成 貨櫃／Excel → 背景開貨櫃頁用它自己的 tkImp 匯入 → IndexedDB 有資料 → 上雲
// → 只有「✈️ 發摘要」（貨櫃沒有核可）→ 同檔再丟＝已匯入過、不勾選；重匯 0 重複 → 貨櫃頁 ⇧ 直接在本頁匯入（不開 iframe）
// → 📝 報告 .docx（中英標題、管理摘要、期間比較含 20ft／40ft／40HQ、明細）；en 介面無中文 → QR 模式也會 markPageReady。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-container-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
function write(name,sheets){const p=path.join(tmp,name);fs.writeFileSync(p,xlsxBuf(sheets));return p;}
const F=p=>({name:path.basename(p),mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fs.readFileSync(p)});
/* 貨櫃車登記表：標題三層（英／中／柬），資料從標題後第 3 列起；欄序固定 No／Date／Name／Licence／Container No／Truck No／Company／Import／Export／Visitor ID／Time In／Sign／Time Out／Sign／Remark */
const HEAD=[['No','Date','Driver name','Licence No','Container No','Truck No','Company','Import','Export','Visitor ID','Time In','Sign In','Time Out','Sign Out','Remark'],
  ['序號','日期','司機姓名','駕照號','貨櫃號','車牌','公司','進口','出口','訪客證','進廠時間','簽名','出廠時間','簽名','備註'],
  ['ល.រ','កាលបរិច្ឆេទ','ឈ្មោះអ្នកបើកបរ','ប័ណ្ណបើកបរ','លេខកុងតឺន័រ','ស្លាកលេខ','ក្រុមហ៊ុន','នាំចូល','នាំចេញ','ប័ណ្ណភ្ញៀវ','ម៉ោងចូល','ហត្ថលេខា','ម៉ោងចេញ','ហត្ថលេខា','កំណត់ចំណាំ']];
const tkFile=write('Container truck register Sep 2026.xlsx',[{name:'Container',rows:[['VRT Container Truck In/Out Register 2026-09']].concat(HEAD,[
  [1,'2026-09-02','Sok Chea','DL12345','MSKU1234567 40HQ','2A-5678','Maersk','P','','V001','08:10','Phea','11:40','Phea',''],
  [2,'2026-09-03','Dara Vann','DL22334','TCLU7654321 20FT','2B-1122','KMTC','','P','V002','09:00','Phea','','','still loading'],
  [3,'2026-09-10','Rith Sok','DL33445','OOLU5556667 40FT','2C-3344','OOCL','P','','V003','13:30','Phea','16:05','Phea','']])}]);
const oddFile=write('random numbers.xlsx',[{name:'Sheet1',rows:[['a','b'],[1,2],[3,4]]}]);
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
  /* ① 貨櫃車登記表 → 自動判斷 → 背景匯入 → 上雲 → 只有發摘要 */
  await pg.setInputFiles('#homeHub [data-file]',[F(tkFile),F(oddFile)]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===2&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands.slice(0,3)})));
  const ti=items.find(x=>/Container/.test(x.name)),oi=items.find(x=>/random/.test(x.name));
  assert.equal(ti.tool,'container',JSON.stringify(ti));assert.equal(ti.kind,'excel');assert.equal(ti.state,'ready','auto-detected without asking: '+JSON.stringify(ti));assert(ti.on);assert.equal(ti.month,'2026-09','period guessed from the sheet dates');
  assert(!ti.cands.some(c=>c.tool==='commute'),'truck register is not mistaken for a commute gate log: '+JSON.stringify(ti.cands));
  assert.equal(oi.state,'ask');assert(!oi.on,'unknown sheet is not imported without asking');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg})));
  const done=items.find(x=>/Container/.test(x.name));assert.equal(done.state,'ok',JSON.stringify(items));assert.match(done.msg,/已上雲|uploaded/,'waited for the module cloud sync: '+done.msg);
  const tk=await pg.evaluate(()=>SEC.dbGet('vrt_truck_v2',[]));
  const sep=tk.filter(r=>/^2026-09/.test(r.date));assert.equal(sep.length,3,'tkImp wrote the 3 trucks: '+JSON.stringify(tk.map(r=>[r.date,r.containerNo,r.name])));
  const t1=sep.find(r=>/MSKU1234567/.test(r.containerNo));assert(t1&&t1.name==='Sok Chea'&&t1.truckNo==='2A-5678'&&t1.company==='Maersk'&&t1.isImport===true&&t1.isExport===false&&t1.timeIn==='08:10'&&t1.timeOut==='11:40'&&t1.visitorId==='V001','truck row fields: '+JSON.stringify(t1));
  const t2=sep.find(r=>/TCLU7654321/.test(r.containerNo));assert(t2&&t2.isExport===true&&!t2.isImport&&t2.timeOut===''&&t2.remark==='still loading','export truck still inside: '+JSON.stringify(t2));
  assert(Object.keys(cloud.disk).some(k=>/smart_container/.test(k)),'uploaded to the (fake) cloud');
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'hub-home-container.png'),fullPage:true});
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要|Send summary/.test(a[0])&&/ac_sec_container_v2\.html\?tg=summary&ptype=month&period=2026-09/.test(a[1])),'summary action for container 2026-09: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可|Approval/.test(a[0])),'container has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 0 重複 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[F(tkFile)]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,on:it.on,tool:it.tool})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  const tk2=await pg.evaluate(()=>SEC.dbGet('vrt_truck_v2',[]));assert.equal(tk2.filter(r=>/^2026-09/.test(r.date)).length,3,'re-import does not duplicate');
  /* ③ 發摘要 → 貨櫃頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_container_v2.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/MSKU1234567|TCLU7654321|40HQ/.test(prev),'preview has imported data: '+prev.slice(0,300));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：本頁模組直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  const f2=write('貨櫃車進出登記 2026-10.xlsx',[{name:'10月',rows:[['貨櫃車進出登記表']].concat(HEAD,[[1,'2026-10-01','Chan Rith','DL55667','CMAU9998887 40HQ','2D-7788','CMA CGM','','P','V010','07:50','Phea','10:20','Phea','']])}]);
  await pg.setInputFiles('.hub-mask [data-file]',[F(f2)]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  const live=await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state})));assert.deepEqual(live,[{tool:'container',kind:'excel',state:'ready'}],'Chinese-named register detected on the page hub: '+JSON.stringify(live));
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  assert.equal(await pg.evaluate(()=>TK.filter(r=>/CMAU9998887/.test(r.containerNo)&&r.date==='2026-10-01').length),1,'live page data updated');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'container',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  const pv=await pg.textContent('[data-preview]');assert(/貨櫃|Container/.test(pv)&&/40HQ|20ft|MSKU1234567|TCLU7654321/.test(pv),'preview from the same summary logic: '+pv.slice(0,200));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'report-modal-container.png'),fullPage:true});
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_container_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/貨櫃出入/.test(docText)&&/Container/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/MSKU1234567/.test(docText)&&/TCLU7654321/.test(docText)&&/Maersk/.test(docText),'detail rows in the Word');
  assert(/Import 40HQ/.test(docText)&&/Export 20ft/.test(docText)&&/Still inside/.test(docText),'KPI rows by size and direction');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'container'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  const pvEn=await pg.textContent('[data-preview]');assert(!CJK.test(pvEn),'en-km preview has no Chinese: '+pvEn.slice(0,200));
  await pg.click('[data-close]');await pg.evaluate(()=>SEC.setLang('zh'));
  /* ⑥ QR 模式：資料載入後仍會 markPageReady（背景匯入不會卡住） */
  await pg.goto('https://offline.test/ac_sec_container_v2.html?qr=container&mode=truck&token=test');
  await pg.waitForSelector('#qrContainerRoot',{timeout:30000});
  const qrReady=await pg.evaluate(()=>Promise.race([SEC.importers().container.ready.then(()=>true),new Promise(r=>setTimeout(()=>r(false),15000))]));
  assert.equal(qrReady,true,'importer ready resolves in QR mode too');
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × container — truck register auto-detected (not mistaken for commute gate), background import via the page\'s own tkImp + cloud wait, summary-only action, same content = already imported, re-import no duplicates, "send summary" opens the Telegram modal, header ⇧ imports live, Word report with size/direction KPIs and details, en without Chinese, QR mode marks ready');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
