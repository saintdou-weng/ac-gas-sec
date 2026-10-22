// 2026-10-22 智慧匯入中心 × CCTV 監控頁。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：攝影機清單 xlsx（編號／名稱／區域／類型／狀態／備註，CCTV A-01 類正式編號）→ 自動判成 CCTV／Excel → 背景開 CCTV 頁用它自己的 impExcel 匯入 → 上雲 → 「✈️ 發摘要」連到 ?tg=summary
// → 同檔再丟＝已匯入過、不勾選 → 勾回去重匯 0 新增（正式編號去重）→ 發摘要開 CCTV 頁 Telegram 巡檢摘要視窗
// CCTV 頁：⇧ 丟 B 廠清單 → 直接在本頁匯入（不開 iframe）；儲存一次巡檢後 📝 產生報告下載 .docx（標題雙語、巡檢摘要＋設備異動、明細含異常攝影機）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-cctv-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const camRows=[['VRT CCTV camera list'],['Code','Name','Zone','Type','NVR','Channel','IP','Status','Remark'],
  ['CCTV A-01','Front gate entrance','Front Gate','Dome','NVR1',1,'192.168.1.11','Online',''],
  ['CCTV A-02','Building A sewing line 1','Building A','Bullet','NVR1',2,'192.168.1.12','Online',''],
  ['CCTV A-03','Finished goods store door','Finishing','Dome','NVR1',3,'192.168.1.13','Offline','No video since Aug'],
  ['CCTV A-04','Office corridor','Office','Dome','NVR1',4,'192.168.1.14','Online','']];
const camFile=path.join(tmp,'CCTV camera list Sep 2026.xlsx');fs.writeFileSync(camFile,xlsxBuf([{name:'CCTV',rows:camRows}]));
const camB=[['Code','Name','Zone','Type','Status'],['CCTV B-01','Building B main gate entrance','Building B','Dome','Online'],['CCTV B-02','Building B back door','Back Gate','Bullet','Online']];
const camFileB=path.join(tmp,'CCTV B factory.xlsx');fs.writeFileSync(camFileB,xlsxBuf([{name:'Sheet1',rows:camB}]));
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
  /* ① 攝影機清單 xlsx → 自動判斷 CCTV／excel → 背景匯入 → 上雲 → 動作按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[camFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'cctv',JSON.stringify(items));assert.equal(items[0].kind,'excel','camera list detected as cctv/excel: '+JSON.stringify(items[0].cands));
  assert.equal(items[0].state,'ready');assert(items[0].on);
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg})));
  assert.equal(items[0].state,'ok',JSON.stringify(items));assert.match(items[0].msg,/已上雲|uploaded/,'waited for the module cloud sync: '+items[0].msg);
  const db=await pg.evaluate(()=>SEC.dbGet('ac_sec_cctv_db',[]));
  assert.deepEqual(db.map(c=>c.code).sort(),['CCTV A-01','CCTV A-02','CCTV A-03','CCTV A-04'],'cctv page importer wrote the cameras: '+JSON.stringify(db.map(c=>c.code)));
  const a3=db.find(c=>c.code==='CCTV A-03');assert.equal(a3.zone,'fwh');assert.equal(a3.status,'off');assert.equal(a3.factory,'a','zone/status/factory parsed by the page importer: '+JSON.stringify(a3));
  assert(Object.keys(cloud.disk).some(k=>/smart_cctv/.test(k)),'uploaded to the (fake) cloud: '+Object.keys(cloud.disk).join(','));
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/^ac_sec_cctv_v2\.html\?tg=summary&ptype=month/.test(a[1])),'summary action for cctv: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可/.test(a[0])),'cctv has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 0 新增（正式編號去重） */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[camFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,on:it.on,tool:it.tool})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  const db2=await pg.evaluate(()=>SEC.dbGet('ac_sec_cctv_db',[]));assert.equal(db2.length,4,'re-import does not duplicate cameras');
  /* ③ 發摘要 → CCTV 頁開 Telegram 巡檢摘要視窗 */
  await pg.goto('https://offline.test/ac_sec_cctv_v2.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/CCTV/.test(prev)&&/4/.test(prev),'preview has imported cameras: '+prev.slice(0,200));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：本頁模組直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  await pg.setInputFiles('.hub-mask [data-file]',[camFileB]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  const gi=await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state,cands:it.cands})));
  assert.equal(gi[0].tool,'cctv');assert.equal(gi[0].kind,'excel');assert.equal(gi[0].state,'ready','B-factory list detected: '+JSON.stringify(gi[0].cands));
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  assert.deepEqual(await pg.evaluate(()=>DB.map(c=>c.code).sort()),['CCTV A-01','CCTV A-02','CCTV A-03','CCTV A-04','CCTV B-01','CCTV B-02'],'live page data updated');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 儲存一次巡檢（A-03 離線），再 📝 產生 Word */
  await pg.evaluate(()=>{document.getElementById('cDate').value='2026-09-20';document.getElementById('cBy').value='Tester';document.getElementById('cNote').value='A-03 no video, vendor called';DB.forEach(c=>{TODAY[c.id]=c.code==='CCTV A-03'?'off':'ok';});return saveDayNow(false);});
  await pg.waitForTimeout(300);
  assert.equal(await pg.evaluate(()=>LOG.length),1,'inspection saved');
  await pg.evaluate(()=>SEC.Report.open({tool:'cctv',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  assert((await pg.$$eval('[data-scope] option',o=>o.map(x=>x.value))).join(',').indexOf('all,factory:a,factory:b')===0,'scope options from the page');
  const pv=await pg.textContent('[data-preview]');assert(/CCTV 巡檢|CCTV check/.test(pv)&&/設備異動|Camera changes/.test(pv),'preview has inspection summary + asset changes: '+pv.slice(0,300));
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_cctv_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/CCTV 監控/.test(docText)&&/CCTV/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/CCTV A-03/.test(docText)&&/Offline/.test(docText)&&/2026-09-20/.test(docText),'faulty camera detail row in the Word');
  assert(/Cameras/.test(docText)&&/Faulty/.test(docText)&&/Days checked/.test(docText),'KPI rows');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'cctv'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × cctv — camera list auto-detected (cctv/excel), background import via impExcel + cloud wait, summary action link, same file = already imported, re-import no duplicates, "send summary" opens the CCTV Telegram modal, header ⇧ imports live, Word report (inspection summary + camera changes, KPIs, faulty-camera details) generated, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
