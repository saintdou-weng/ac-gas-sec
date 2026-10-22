// 2026-10-22 智慧匯入中心 × 保安費用頁。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：保安服務費申請表 xlsx（company／MONTH／DAY＋day shift／Night shift 段）→ 自動判成 費用／保安費 → 背景開費用頁用它自己的 impFee 匯入 → 上雲
// → 動作按鈕「✈️ 發摘要」＋「✅ 核可」（?tg=summary／?tg=approval）→ 同檔再丟＝已匯入過、不勾選 → 勾回去重匯 0 新增
// → ?tg=approval 開費用頁 Telegram 視窗：核可模式按鈕為作用中、預覽為核可卡、有可送核項目時「傳送」可按（tgOpen 的 canApprove：expense 模組＋canApprove:true）
// 費用頁：⇧ 丟一般費用表 → 判成 費用／Excel → 直接在本頁 impExcel 匯入（不開 iframe）；📝 產生報告下載 .docx（標題雙語、摘要、明細含真實金額）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-expense-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
/* 保安服務費申請表（security_service_fee_application 格式；MONTH 為 Excel 日期序號 2026-09-01） */
const feeRows=[['company','ICSC','','month',46266],['day',30],[],['day shift'],['no','name','location','per month','total wk day','total wk hr','total hour','one hour','total pay'],
  [1,'Guard One','Gate A',300,26,8,208,1.44,300],[2,'Guard Two','Gate B',300,26,8,208,1.44,300],['Night shift'],[1,'Guard Three','Gate A',320,26,8,208,1.54,320],['','total','','','','','','',920]];
const feeFile=path.join(tmp,'Security service fee application Sep 2026.xlsx');fs.writeFileSync(feeFile,xlsxBuf([{name:'Sep',rows:feeRows}]));
/* 一般費用表 */
const expRows=[['Date','Item','Category','Vendor','Qty','Unit','Price','Amount','Reason'],['2026-09-12','Flashlight batteries','Consumable','Lucky Mart',4,'pack',2.5,10,'Night patrol'],['2026-09-15','Radio repair','Repair','Tech Shop',1,'pc',35,35,'Handset 3 broken']];
const expFile=path.join(tmp,'Security expense Sep 2026.xlsx');fs.writeFileSync(expFile,xlsxBuf([{name:'Expense',rows:expRows}]));
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
  /* ① 保安服務費申請表 → 自動判斷 費用／fee → 背景匯入 → 上雲 → 摘要＋核可按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[feeFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'expense',JSON.stringify(items));assert.equal(items[0].kind,'fee','fee application detected as expense/fee: '+JSON.stringify(items[0].cands));
  assert.equal(items[0].state,'ready');assert(items[0].on);assert.equal(items[0].month,'2026-09','period guessed from the MONTH cell');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg})));
  assert.equal(items[0].state,'ok',JSON.stringify(items));assert.match(items[0].msg,/已上雲|uploaded/,'waited for the module cloud sync: '+items[0].msg);
  const db=await pg.evaluate(()=>SEC.dbGet('ac_sec_expense_db',[]));
  assert.deepEqual(db.map(r=>r.code).sort(),['SVC-202609-001','SVC-202609-002','SVC-202609-003'],'expense page importer wrote the fee rows: '+JSON.stringify(db.map(r=>r.code)));
  assert(db.every(r=>r.date==='2026-09-01'&&r.cat==='保安服務費 Security Service'&&r.vendor==='ICSC'&&!r.batchId),'fee rows parsed by impFee: '+JSON.stringify(db[0]));
  assert.equal(db.reduce((s,r)=>s+r.amount,0),920);
  assert(Object.keys(cloud.disk).some(k=>/smart_expense/.test(k)),'uploaded to the (fake) cloud: '+Object.keys(cloud.disk).join(','));
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/^ac_sec_expense_v1\.html\?tg=summary&ptype=month&period=2026-09$/.test(a[1])),'summary action for expense 2026-09: '+JSON.stringify(acts));
  assert(acts.some(a=>/核可/.test(a[0])&&/^ac_sec_expense_v1\.html\?tg=approval&ptype=month&period=2026-09$/.test(a[1])),'approval action for expense 2026-09: '+JSON.stringify(acts));
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 0 新增（feeImportKey 去重） */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[feeFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,on:it.on,tool:it.tool})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  const db2=await pg.evaluate(()=>SEC.dbGet('ac_sec_expense_db',[]));assert.equal(db2.length,3,'re-import does not duplicate fee rows');
  /* ③ 核可 → 費用頁開 Telegram 視窗，核可模式作用中、期間預選、可送核的 3 筆讓「傳送」可按 */
  await pg.goto('https://offline.test/ac_sec_expense_v1.html?tg=approval&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  await pg.waitForFunction(()=>{const b=document.querySelector('.tg-mask [data-tg-mode="approval"]');return b&&b.classList.contains('on');},null,{timeout:5000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const modeState=await pg.evaluate(()=>{const a=document.querySelector('.tg-mask [data-tg-mode="approval"]'),s=document.querySelector('.tg-mask [data-tg-mode="summary"]');return {approvalOn:a.classList.contains('on'),approvalShown:!a.hidden&&!a.disabled,summaryOn:s.classList.contains('on'),sendDisabled:document.querySelector('.tg-mask #tgSend').disabled};});
  assert.deepEqual(modeState,{approvalOn:true,approvalShown:true,summaryOn:false,sendDisabled:false},'approval mode active with 3 approvable fee items: '+JSON.stringify(modeState));
  let prev=await pg.textContent('.tg-mask #tgPreview');assert(/保安費核可|Security fee approval/.test(prev)&&/Guard One/.test(prev)&&/\$920\.00/.test(prev),'approval preview with the imported fee items: '+prev.slice(0,300));
  await pg.click('.tg-mask [data-tg-mode="summary"]');prev=await pg.textContent('.tg-mask #tgPreview');assert(/保安費用|Security expenses/.test(prev)&&/\$920\.00/.test(prev),'summary preview: '+prev.slice(0,200));
  await pg.click('.tg-mask [data-tg-close]');
  /* 發摘要連結：摘要模式 */
  await pg.goto('https://offline.test/ac_sec_expense_v1.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});await pg.waitForTimeout(200);
  assert(await pg.evaluate(()=>document.querySelector('.tg-mask [data-tg-mode="summary"]').classList.contains('on')&&!document.querySelector('.tg-mask [data-tg-mode="approval"]').classList.contains('on')),'summary link keeps summary mode');
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：一般費用表判成 excel，直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  await pg.setInputFiles('.hub-mask [data-file]',[expFile]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  const gi=await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state,month:it.month,cands:it.cands})));
  assert.equal(gi[0].tool,'expense');assert.equal(gi[0].kind,'excel','general expense sheet detected as expense/excel: '+JSON.stringify(gi[0].cands));assert.equal(gi[0].state,'ready');assert.equal(gi[0].month,'2026-09');
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  const imp=await pg.evaluate(()=>DB.filter(r=>/^IMP-/.test(r.code)).map(r=>[r.date,r.name,r.amount]));
  assert.deepEqual(imp.sort(),[['2026-09-12','Flashlight batteries',10],['2026-09-15','Radio repair',35]],'live page data updated by impExcel: '+JSON.stringify(imp));
  assert.equal(await pg.evaluate(()=>DB.filter(r=>/^SVC-/.test(r.code)).length),3,'fee rows still there');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'expense',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  const pv=await pg.textContent('[data-preview]');assert(/保安費用|Security expenses/.test(pv)&&/\$965\.00/.test(pv),'preview with totals: '+pv.slice(0,200));
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_expense_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/保安費用/.test(docText)&&/Security Expense/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/SVC-202609-001/.test(docText)&&/Guard One/.test(docText)&&/\$300\.00/.test(docText)&&/Radio repair/.test(docText)&&/\$35\.00/.test(docText),'detail rows with real amounts in the Word');
  assert(/Total amount/.test(docText)&&/965\.00/.test(docText)&&/Security fee items/.test(docText)&&/Not sent \/ rejected/.test(docText),'KPI rows');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'expense'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × expense — fee application auto-detected (expense/fee), background import via impFee + cloud wait, summary + approval action links, same file = already imported, re-import no duplicates, ?tg=approval opens the expense Telegram modal in approval mode with sendable items, header ⇧ imports a general expense sheet live via impExcel, Word report (summary, KPIs, details with amounts) generated, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
