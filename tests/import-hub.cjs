// 2026-10-22 智慧匯入中心（首頁＋頁首 ⇧）與參考報告（Word）。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：消防設備 xlsx（自動判成 消防／設備清單，背景開消防頁用它自己的 impExcel 匯入，上雲）→ 同檔再丟＝已匯入過、不勾選
// → zip 內的 xlsx、msg 的附件都會展開 → 認不出的檔會問 → 「✈️ 發摘要」開消防頁並預選期間
// 消防頁：⇧ 開視窗直接在本頁匯入；📝 產生報告下載 .docx（內容有標題、摘要、明細）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const fireRows=[['VRT Fire Extinguisher Monthly Check 2026-09'],['No','Code','Location','Date check','Expire Date','Checked by','Remarks'],[1,'FE01','Gate A','2026-09-05','2027-03-01','Sok',''],[2,'FE02','Canteen','2026-09-05','2027-03-01','Sok','X pressure low'],[3,'FE03','Sewing line 3','2026-09-06','2027-03-01','Dara','']];
const fireFile=path.join(tmp,'Fire Extinguisher check Sep 2026.xlsx');fs.writeFileSync(fireFile,xlsxBuf([{name:'Fire Extinguisher',rows:fireRows}]));
const oddFile=path.join(tmp,'random numbers.xlsx');fs.writeFileSync(oddFile,xlsxBuf([{name:'Sheet1',rows:[['a','b'],[1,2],[3,4]]}]));
(async()=>{
 /* zip 與 msg 用瀏覽器裡的 JSZip／oxmsg 做不到，改用 node：zip 用 shared 的 xlsx 內建 CFB？不行 — 直接用 python zipfile */
 const zipFile=path.join(tmp,'fire-pack.zip');require('child_process').execFileSync('python3',['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],"w");z.write(sys.argv[2],"docs/"+sys.argv[2].split("/")[-1]);z.close()',zipFile,fireFile]);
 let msgFile='';const mk=process.env.SEC_MSG_WRITER;if(mk&&fs.existsSync(mk)){msgFile=path.join(tmp,'mail.msg');require('child_process').execFileSync('node',[mk,msgFile,'FW: Fire check Sep 2026',fireFile],{cwd:path.dirname(mk)});}
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
  /* ① 消防 xlsx → 自動判斷 → 背景匯入 → 上雲 → 動作按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[fireFile,oddFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===2&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month})));
  const fi=items.find(x=>/Fire/.test(x.name)),oi=items.find(x=>/random/.test(x.name));
  assert.equal(fi.tool,'fire');assert.equal(fi.kind,'equipment');assert.equal(fi.state,'ready');assert(fi.on);assert.equal(fi.month,'2026-09','period guessed from the sheet dates');
  assert.equal(oi.state,'ask');assert(!oi.on,'unknown sheet is not imported without asking');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg})));
  const done=items.find(x=>/Fire/.test(x.name));assert.equal(done.state,'ok',JSON.stringify(items));assert.match(done.msg,/已上雲|uploaded/,'waited for the module cloud sync: '+done.msg);
  const db=await pg.evaluate(()=>SEC.dbGet('ac_sec_fire_db',[]));assert.equal(db.filter(e=>/^FE0[123]$/.test(e.code)).length,3,'fire page importer wrote the equipment: '+db.length);
  const hist=await pg.evaluate(()=>SEC.dbGet('ac_sec_fire_hist',[]));assert(hist.some(h=>h.date==='2026-09-05'),'inspection history from the same importer');
  assert(Object.keys(cloud.disk).some(k=>/smart_fire/.test(k)),'uploaded to the (fake) cloud');
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'hub-home.png'),fullPage:true});
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/ac_sec_fire_v1\.html\?tg=summary&ptype=month&period=2026-09/.test(a[1])),'summary action for fire 2026-09: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可/.test(a[0])),'fire has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；zip 內的同檔也一樣 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[fireFile,zipFile].concat(msgFile?[msgFile]:[]));
  await pg.waitForFunction(()=>HOME_HUB.items.length>=2&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,via:it.via,state:it.state,on:it.on,tool:it.tool})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  assert(items.some(x=>/fire-pack\.zip/.test(x.via)),'zip expanded');
  if(msgFile)assert(items.some(x=>/mail\.msg/.test(x.via)&&/Fire check Sep 2026/.test(x.via)),'msg attachment expanded with subject: '+JSON.stringify(items));
  /* 勾回去重匯 → 0 新增（模組自己的去重） */
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  const db2=await pg.evaluate(()=>SEC.dbGet('ac_sec_fire_db',[]));assert.equal(db2.filter(e=>/^FE0[123]$/.test(e.code)).length,3,'re-import does not duplicate');
  const hist2=await pg.evaluate(()=>SEC.dbGet('ac_sec_fire_hist',[]));assert.equal(hist2.length,hist.length,'history not duplicated');
  /* ③ 發摘要 → 消防頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_fire_v1.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/FE02|2026-09|FE0/.test(prev),'preview has imported data: '+prev.slice(0,200));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：本頁模組直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  const f2=path.join(tmp,'Fire Alarm check Oct 2026.xlsx');fs.writeFileSync(f2,xlsxBuf([{name:'Fire Alarm',rows:[['Fire alarm check'],['No','Code','Location','Date check','Checked by'],[1,'FA01','Gate','2026-10-03','Sok'],[2,'FA02','Office','2026-10-03','Sok']]}]));
  await pg.setInputFiles('.hub-mask [data-file]',[f2]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  assert.equal(await pg.evaluate(()=>DB.filter(e=>/^FA0[12]$/.test(e.code)).length),2,'live page data updated');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'fire',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  const pv=await pg.textContent('[data-preview]');assert(/消防|Fire/.test(pv)&&pv.length>20,'preview: '+pv.slice(0,120));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'report-modal.png'),fullPage:true});
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_fire_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/消防設施/.test(docText)&&/Fire Equipment/.test(docText)&&/Monthly Report/.test(docText),'title');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/FE02/.test(docText),'detail rows in the Word');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'fire'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub — auto-detect fire sheet, background import via the page\'s own importer + cloud wait, unknown file asks, same content = already imported, zip'+(msgFile?'/msg':'')+' expanded, re-import no duplicates, "send summary" opens the page Telegram modal with the period, header ⇧ imports live, Word report generated with summary/comparison/details, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
