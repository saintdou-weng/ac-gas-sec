// 2026-10-22 智慧匯入中心 × 保安巡邏頁。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟：巡更棒匯出 xlsx（中文＋英文雙層標題）→ 自動判成 巡邏／巡邏機紀錄 → 背景開巡邏頁用它自己的 impWand 匯入 → 上雲 → 「✈️ 發摘要」連到 ?tg=summary&period
// → 同檔再丟＝已匯入過、不勾選 → 勾回去重匯 0 新增 → 發摘要開巡邏頁 Telegram 視窗並預選期間
// 巡邏頁：⇧ 丟一般巡邏表 → 判成 巡邏／一般巡邏表 → 直接在本頁 impGeneric 匯入（不開 iframe）；📝 產生報告下載 .docx（標題雙語、摘要、明細、真實資料）。en 介面無中文。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-patrol-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
/* 巡更棒原始匯出：中文標題列＋英文標題列＋資料（巡检点＝未设置，用 Chip ID 辨識）；現行 12 點一圈（夜巡一圈完整、日巡一圈漏 2 點） */
const chips=['0F004EBEFC','3A0073B8C6','3300A5D392','3300A5CD4C','3300A635E9','3300A5A761','0F004E86D9','3300A542BE','3300A5554E','3300A585AB','3300A5E151','3300A5E13D'];
const wandRows=[['巡检记录'],['巡检时间','巡检器','人员','巡检点','事件','编号'],['Patrol Time','ReaderNum','Person','Checkpoint','Event','Chip ID']]
  .concat(chips.map((c,i)=>['2026/09/05 22:'+String(10+i*2).padStart(2,'0')+':07','R1','Guard Web','未设置','Night Shift',c]))
  .concat(chips.slice(0,10).map((c,i)=>['2026/09/06 08:'+String(5+i*2).padStart(2,'0')+':30','R1','Guard Day','未设置','Day Shift',c]));
const wandFile=path.join(tmp,'Patrol record Sep 2026.xlsx');fs.writeFileSync(wandFile,xlsxBuf([{name:'Month',rows:wandRows}]));
/* 一般（人工）巡邏表 */
const genRows=[['Date','Time','Shift','Guard','Location','Status','Note'],['2026-09-07','08:30','Day','Guard Z','Gate A','OK',''],['2026-09-07','19:30','Night','Guard Z','Yard','Issue','Light broken']];
const genFile=path.join(tmp,'Patrol log Sep 2026.xlsx');fs.writeFileSync(genFile,xlsxBuf([{name:'Patrol',rows:genRows}]));
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
  /* ① 巡更棒 xlsx → 自動判斷 巡邏／wand → 背景匯入 → 上雲 → 動作按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[wandFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands})));
  assert.equal(items[0].tool,'patrol',JSON.stringify(items));assert.equal(items[0].kind,'wand','wand export detected as patrol reader log: '+JSON.stringify(items[0].cands));
  assert.equal(items[0].state,'ready');assert(items[0].on);assert.equal(items[0].month,'2026-09','period guessed from the scan times');
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.some(it=>it.state==='ok'),null,{timeout:180000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg})));
  assert.equal(items[0].state,'ok',JSON.stringify(items));assert.match(items[0].msg,/已上雲|uploaded/,'waited for the module cloud sync: '+items[0].msg);
  const scan=await pg.evaluate(()=>SEC.dbGet('ac_sec_patrol_scan',[]));
  assert.equal(scan.length,22,'patrol page importer wrote the scans: '+scan.length);
  assert(scan.some(s=>s.t==='2026-09-05 22:10:07'&&s.c==='0F004EBEFC'&&s.e==='N'),'wand time/chip/shift parsed by the page importer: '+JSON.stringify(scan[0]));
  assert(Object.keys(cloud.disk).some(k=>/smart_patrol/.test(k)),'uploaded to the (fake) cloud: '+Object.keys(cloud.disk).join(','));
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要/.test(a[0])&&/ac_sec_patrol_v2\.html\?tg=summary&ptype=month&period=2026-09/.test(a[1])),'summary action for patrol 2026-09: '+JSON.stringify(acts));
  assert(!acts.some(a=>/核可/.test(a[0])),'patrol has no approval');
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 0 新增（impWand 分鐘精度去重） */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[wandFile]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,on:it.on,tool:it.tool})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  await pg.check('#homeHub [data-on]');await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:180000});
  const scan2=await pg.evaluate(()=>SEC.dbGet('ac_sec_patrol_scan',[]));assert.equal(scan2.length,22,'re-import does not duplicate scans');
  /* ③ 發摘要 → 巡邏頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_patrol_v2.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  assert.equal(new URL(pg.url()).search,'','query cleaned so reload does not reopen');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/Guard Web|Guard Day|巡邏/.test(prev),'preview has imported data: '+prev.slice(0,200));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：一般巡邏表判成 generic，直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  await pg.setInputFiles('.hub-mask [data-file]',[genFile]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  const gi=await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state,cands:it.cands})));
  assert.equal(gi[0].tool,'patrol');assert.equal(gi[0].kind,'generic','manual patrol sheet detected as generic: '+JSON.stringify(gi[0].cands));assert.equal(gi[0].state,'ready');
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  const man=await pg.evaluate(()=>MAN.filter(r=>r.guard==='Guard Z').map(r=>[r.date,r.time,r.shift,r.status]));
  assert.deepEqual(man.sort(),[['2026-09-07','08:30','D','ok'],['2026-09-07','19:30','N','issue']],'live page data updated by impGeneric: '+JSON.stringify(man));
  assert.equal(await pg.evaluate(()=>SCAN.length),22,'wand scans still there');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'patrol',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  assert.deepEqual(await pg.$$eval('[data-ptype] option',o=>o.map(x=>x.value)),['day','week','month','year'],'day/week/month/year report types');
  assert.deepEqual(await pg.$$eval('[data-scope] option',o=>o.map(x=>x.value)),['all','day','night'],'scope options');
  const pv=await pg.textContent('[data-preview]');assert(/巡邏摘要|Patrol Summary/.test(pv)&&/夜巡達標|Night Patrol Compliance/.test(pv),'preview has patrol + night summary: '+pv.slice(0,200));
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_patrol_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/保安巡邏/.test(docText)&&/Patrol/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/Guard Web/.test(docText)&&/Guard Z/.test(docText),'detail rows (wand rounds + manual patrol) in the Word');
  assert(/Rounds/.test(docText)&&/Missed points/.test(docText),'KPI rows');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'patrol'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × patrol — wand export auto-detected (patrol/wand), background import via impWand + cloud wait, summary action link, same file = already imported, re-import no duplicates, "send summary" opens the patrol Telegram modal with the period, header ⇧ imports a manual patrol sheet live via impGeneric, Word report (day/week/month/year, scope, summary + night pages, details) generated, en without Chinese');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
