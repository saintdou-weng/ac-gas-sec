// 2026-10-22 智慧匯入中心 × 保安人員（照 tests/import-hub.cjs）。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：Security Roaster 月排班（自動判成 人員／名冊，背景開人員頁用它自己的 importRosterFile 匯入，上雲）→ 同檔再丟＝已匯入過、不勾選 → 重匯不重複
// → 「✈️ 發摘要」開人員頁並預選期間；人員頁：⇧ 直接在本頁匯入一般名冊（不開 iframe）；📝 產生報告下載 .docx（標題中英、摘要、明細）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-per-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
const days=n=>Array.from({length:n},(_,i)=>i+1),dn=s=>s.split('').map(c=>c==='D'?'D':c==='N'?'N':'Off');
/* Security Roaster：No | ID NO | NAME | SCHEDULE | POST | 1…30（D／N／Off） */
const rosterRows=[['VRT Security Roaster · September 2026'],['Period','2026-09-01','2026-09-30'],['No','ID NO','NAME','SCHEDULE','POST',...days(30)],
 [1,'A001','Sok Dara','Day','Gate A',...dn('DDDDDoDDDDDDoDDDDDDoDDDDDDoDDD')],
 [2,'A002','Chan Vuthy','Night','Gate B',...dn('NNNNNoNNNNNNoNNNNNNoNNNNNNoNNN')],
 [3,'A003','Kim Sokha','Day','Patrol',...dn('DDDDDoDDDDDDoDDDDDDoDDDDDDoDDD')]];
const rosterFile=path.join(tmp,'Security Roaster Sep 2026.xlsx');fs.writeFileSync(rosterFile,xlsxBuf([{name:'Roaster',rows:rosterRows}]));
/* 一般名冊（SPEC 欄位）：本頁 ⇧ 用 */
const listRows=[['工號','姓名','職稱','班別','崗位','到職日','電話'],['A004','Pich Ratha','保安員','C','Gate A','2026-10-05','012 345 678']];
const listFile=path.join(tmp,'Security staff list Oct 2026.xlsx');fs.writeFileSync(listFile,xlsxBuf([{name:'Staff',rows:listRows}]));
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
  /* ① Security Roaster → 自動判斷 → 背景匯入 → 上雲 → 動作按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[rosterFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'personnel',JSON.stringify(items));assert.equal(items[0].kind,'roster');assert.equal(items[0].state,'ready','auto-detected without asking: '+JSON.stringify(items[0].cands));assert(items[0].on);assert.equal(items[0].month,'2026-09');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'||it.state==='err'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg,log:it.log})));
  assert.equal(items[0].state,'ok',JSON.stringify(items));assert.match(items[0].msg,/已上雲|uploaded/,'waited for the personnel cloud sync: '+items[0].msg);
  assert.match(items[0].log,/Security Roaster/,'import log from the page importer: '+items[0].log);
  const db=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_db',[]));
  assert.deepEqual(db.map(r=>r.empId).sort(),['A001','A002','A003'],'personnel page importer wrote the roster: '+JSON.stringify(db.map(r=>r.name)));
  const dara=db.find(r=>r.empId==='A001');assert.equal(dara.name,'Sok Dara');assert.equal(dara.shift,'A');assert.equal(dara.post,'Gate A');assert.equal(dara.status,'active');
  assert.equal(db.find(r=>r.empId==='A002').shift,'C','Night → C');
  const chg=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_chg',[]));assert.equal(chg.filter(c=>c.kind==='join'&&c.effectiveMonth==='2026-09').length,3,'three join changes for September');
  const sched=await pg.evaluate(()=>SEC.dbGet('ac_sec_roster_schedule',{}));assert(sched['2026-09']&&Object.keys(sched['2026-09']).length===3,'daily D/N schedule saved: '+JSON.stringify(Object.keys(sched)));
  assert.equal(sched['2026-09'].A002.days['01'],'N');assert.equal(sched['2026-09'].A001.days['06'],'R');
  assert(Object.keys(cloud.disk).some(k=>/smart_personnel/.test(k)),'uploaded to the (fake) cloud: '+Object.keys(cloud.disk));
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'hub-home-personnel.png'),fullPage:true});
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/ac_sec_personnel_v1\.html\?tg=summary&ptype=month&period=2026-09$/.test(a[1])),'summary action for personnel 2026-09: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可/.test(a[0])),'personnel has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 不重複 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[rosterFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({state:it.state,on:it.on})));assert.equal(items[0].state,'done-before');assert(!items[0].on,'already imported → unticked');
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  assert.equal(await pg.evaluate(()=>HOME_HUB.items[0].state),'ok');
  const db2=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_db',[]));assert.equal(db2.length,3,'re-import does not duplicate people');
  const chg2=await pg.evaluate(()=>SEC.dbGet('ac_sec_personnel_chg',[]));assert.equal(chg2.length,chg.length,'re-import does not duplicate change logs');
  /* ③ 發摘要 → 人員頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_personnel_v1.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/Sok Dara/.test(prev),'preview has imported data: '+prev.slice(0,300));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：一般名冊直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  await pg.setInputFiles('.hub-mask [data-file]',[listFile]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  assert.deepEqual(await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>[it.tool,it.kind,it.state])),[['personnel','roster','ready']]);
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  const ratha=await pg.evaluate(()=>DB.filter(r=>r.empId==='A004').map(r=>({name:r.name,shift:r.shift,post:r.post,joinDate:r.joinDate,status:r.status}))[0]);
  assert.deepEqual(ratha,{name:'Pich Ratha',shift:'C',post:'Gate A',joinDate:'2026-10-05',status:'active'},'live page data updated: '+JSON.stringify(ratha));
  assert.equal(await pg.evaluate(()=>DB.length),4);
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'personnel',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');assert.equal(await pg.inputValue('[data-scope]'),'allChanges','report defaults to all changes in the period');
  const pv=await pg.textContent('[data-preview]');assert(/人員異動|Personnel changes/.test(pv)&&/Sok Dara/.test(pv),'preview: '+pv.slice(0,200));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'report-modal-personnel.png'),fullPage:true});
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_personnel_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/保安人員/.test(docText)&&/Personnel/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/Sok Dara/.test(docText)&&/Kim Sokha/.test(docText)&&/A001/.test(docText),'detail rows in the Word');
  assert(/Active headcount|在職人數/.test(docText)&&/Shift A|A 班/.test(docText),'KPI rows in the comparison table');
  assert(!/Pich Ratha/.test(docText),'October joiner is not in the September report');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'personnel',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × personnel — Security Roaster auto-detected, background import via the page\'s own importRosterFile + cloud wait, same content = already imported, re-import no duplicates, "send summary" opens the Telegram modal with the period, header ⇧ imports a plain roster live, Word report with summary/comparison/details, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
