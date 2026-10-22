// 2026-10-22 智慧匯入中心 × 通勤交通（ac_sec_commute_v2.html）。真 Chromium；雲端用真的 ac_sec.gs（tests/backend.cjs）。
// 首頁丟四種 Excel（派車 transportation_record／摩托車 Motor_Bike／車輛出入閘／Come_Late_Register）→ 四種 kind 全部判對
// → 背景開通勤頁用它自己的 impCar／impBike／impGate／impLate 匯入 → IndexedDB 有資料 → 上雲 → 「✈️ 發摘要」＋「✅ 核可」兩個按鈕
// → 同檔再丟＝已匯入過、不勾選；重匯 0 重複 → 通勤頁 ⇧ 直接在本頁匯入（不開 iframe）
// → 📝 報告 .docx（中英標題、管理摘要、明細、真實資料）；en 介面無中文
// → 首頁丟照片「late form.jpg」→ 依檔名判成 遲到 → 交棒到通勤頁 ?hub=1 → 開 #mCommuteOcr 辨識視窗（OCR 回覆用假的）→ 儲存後寫入遲到紀錄。
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');const XLSX=require('../shared/xlsx.full.min.js');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sec-hub-commute-'));
const CJK=/[㐀-鿿]/;
function xlsxBuf(sheets){const wb=XLSX.utils.book_new();sheets.forEach(s=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name));return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
function write(name,sheets){const p=path.join(tmp,name);fs.writeFileSync(p,xlsxBuf(sheets));return p;}
/* Playwright 的 setInputFiles 遇到非 ASCII 路徑會丟不進去 → 一律用 {name,buffer} 餵（檔名保留中文） */
const F=p=>({name:path.basename(p),mimeType:/\.xlsx$/i.test(p)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'image/jpeg',buffer:fs.readFileSync(p)});
/* ① 派車：transportation_record 格式（每張表一位司機、Reason/KM 成對欄位） */
const carFile=write('transportation_record Sep 2026.xlsx',[{name:'Tola',rows:[
  ['Driver: Tola'],['','Personal','','Bank','','Others',''],['','Long distance','','Company','','Personal',''],
  ['Date','Reason','KM','Reason','KM','Reason','KM'],['Total','',96,'',14,'',0],
  ['2026-09-02','Phnom Penh airport',96,'','','',''],['2026-09-03','','','Go to ABA bank',14,'',''],['2026-09-10','','','Canadia bank',8,'','']]}]);
/* ② 摩托車：Motor_Bike 格式（Building A／B／Total，Sunday 略過） */
const bikeFile=write('Motor_Bike 2026-09.xlsx',[{name:'Sep 2026',rows:[
  ['Motor bike parking count'],['Date','Building A','Building B','Total','Remark'],
  ['2026-09-01',120,80,200,''],['2026-09-02',118,82,200,''],['2026-09-07','Sunday','Sunday','',''],['2026-09-08',125,79,204,'rain']]}]);
/* ③ 車輛出入閘：現場中文表頭（≥6 欄比對） */
const gateFile=write('车辆出入闸登记 2026-09.xlsx',[{name:'9月',rows:[
  ['车辆出入闸登记表'],['日期','序号','车牌号','司机名字','乘客名字','部门','乘客人數','入闸時间','入闸時保安簽客','行驶里數','出闸時间','出闸時保安簽客','行驶里數','用车原因'],
  ['2026-09-03',1,'2AB-1234','Sarun','Jenny','Compliance',2,'08:30','Phea',1200,'10:45','Phea',1230,'Go to bank'],
  ['2026-09-05',2,'2CD-5678','Tongheang','Nin','GA',1,'13:00','Phea',500,'15:20','Phea',512,'Buy spare parts']]}]);
/* ④ 遲到登記：Come_Late_Register（Company ID／DPT／TIME IN／SECURITY／OTHER） */
const lateFile=write('Come_Late_Register Sep 2026.xlsx',[{name:'Come Late',rows:[
  ['COME LATE REGISTER'],['No','Date','Company ID','Name','DPT','Time In','Time Out','Security','Other'],
  [1,'2026-09-03','VRT0123','Sok Dara','Sewing 3','08:12','','Phea',''],[2,'2026-09-03','VRT0456','Chan Sreyleak','Cutting','08:20','','Phea','traffic'],[3,'2026-09-09','VRT0123','Sok Dara','Sewing 3','08:05','','Phea','']]}]);
/* 照片：1×1 PNG，檔名含 late → 遲到 */
const pngFile=path.join(tmp,'late form.jpg');fs.writeFileSync(pngFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64'));
const OCR_FAKE={ok:true,data:{records:[{date:'2026-09-15',empId:'VRT0789',name:'Meas Sokha',dept:'Packing',checkIn:'08:25',checkOut:'',gate:'Phea',note:'',confidence:0.91,uncertainFields:['checkIn']}],warnings:[],provider:'test',model:'test-ocr'}};
(async()=>{
 const cloud=runtime(new Date().toISOString());let ocrCalls=0;
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 async function route(ctx){
  await ctx.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());
   if(u.hostname==='offline.test'){const p=path.join(root,decodeURIComponent(u.pathname));if(fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({status:200,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});return r.fulfill({status:404,body:''});}
   if(u.hostname==='script.google.com'){let out;const body=req.method()==='POST'?(req.postData()||'{}'):'';
    if(/"action"\s*:\s*"ocrForm"/.test(body)){ocrCalls++;const j=JSON.parse(body);assert.equal(j.formType,'late','OCR asked for the late form');assert.match(String(j.image||''),/^data:image\//,'OCR gets the photo as a data URL');return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(OCR_FAKE)});}
    if(req.method()==='POST')out=cloud.c.doPost({postData:{contents:body}}).text;else out=cloud.c.doGet({parameter:Object.fromEntries(u.searchParams)}).text;return r.fulfill({status:200,contentType:'application/json',body:out});}
   return r.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{destroy(){} update(){}};'});});
 }
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});await route(ctx);const pg=await ctx.newPage(),errors=[],dialogs=[];
  pg.on('pageerror',e=>errors.push(e.message));pg.on('dialog',d=>{dialogs.push(d.message());d.accept();});
  await pg.goto('https://offline.test/index.html');await pg.waitForSelector('#homeHub [data-drop]');
  /* ① 四種 Excel → 四種 kind 全判對 → 背景匯入 → 上雲 → 兩個動作按鈕 */
  await pg.setInputFiles('#homeHub [data-file]',[carFile,bikeFile,gateFile,lateFile].map(F));
  await pg.waitForFunction(()=>HOME_HUB.items.length===4&&HOME_HUB.items.every(it=>it.state!=='detect'));
  let items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,tool:it.tool,kind:it.kind,state:it.state,on:it.on,month:it.month,cands:it.cands.slice(0,3)})));
  const byName=re=>items.find(x=>re.test(x.name));
  [[/transportation/,'car'],[/Motor_Bike/,'bike'],[/出入闸/,'gate'],[/Come_Late/,'late']].forEach(([re,kind])=>{const it=byName(re);assert(it,'item '+re);assert.equal(it.tool,'commute',re+' tool: '+JSON.stringify(it));assert.equal(it.kind,kind,re+' kind: '+JSON.stringify(it));assert.equal(it.state,'ready',re+' auto-detected without asking: '+JSON.stringify(it));assert(it.on);assert.equal(it.month,'2026-09',re+' period guessed from the sheet dates');});
  await pg.click('#homeHub [data-run]');
  await pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items.every(it=>it.state==='ok'||it.state==='err'),null,{timeout:240000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,msg:it.msg,log:it.log})));
  items.forEach(it=>{assert.equal(it.state,'ok',JSON.stringify(it));assert.match(it.msg,/已上雲|uploaded/,'waited for the commute cloud sync: '+it.msg);});
  const car=await pg.evaluate(()=>SEC.dbGet('ac_sec_car_db',[]));assert.equal(car.filter(r=>r.driver==='Tola'&&/^2026-09/.test(r.date)).length,3,'impCar wrote the dispatch rows: '+JSON.stringify(car.map(r=>[r.date,r.driver,r.type,r.reason,r.km])));
  assert(car.some(r=>r.type==='Personal · Long distance'&&r.km===96),'dispatch purpose groups resolved from the merged headers');
  const bike=await pg.evaluate(()=>SEC.dbGet('ac_sec_bike_db',[]));assert.equal(bike.filter(r=>/^2026-09/.test(r.date)).length,3,'impBike wrote 3 days (Sunday skipped): '+JSON.stringify(bike));
  assert(bike.some(r=>r.date==='2026-09-08'&&r.a===125&&r.b===79&&r.total===204&&r.remark==='rain'));
  const gate=await pg.evaluate(()=>SEC.dbGet('ac_sec_gate_db',[]));assert.equal(gate.filter(r=>/^2026-09/.test(r.date)).length,2,'impGate wrote the gate rows: '+JSON.stringify(gate));
  const g1=gate.find(r=>r.plate==='2AB-1234');assert(g1&&g1.driver==='Sarun'&&g1.inTime==='08:30'&&g1.outTime==='10:45'&&g1.pax===2&&g1.km===30&&g1.reason==='Go to bank','gate row fields: '+JSON.stringify(g1));
  const late=await pg.evaluate(()=>SEC.dbGet('ac_sec_late_db',[]));assert.equal(late.filter(r=>/^2026-09/.test(r.date)).length,3,'impLate wrote 3 rows: '+JSON.stringify(late));
  assert(late.some(r=>r.empId==='VRT0456'&&r.name==='Chan Sreyleak'&&r.dept==='Cutting'&&r.checkIn==='08:20'&&r.note==='traffic'),'late row fields');
  assert(Object.keys(cloud.disk).some(k=>/smart_commute/.test(k)),'uploaded to the (fake) cloud');
  await pg.waitForTimeout(400);assert.equal(await pg.locator('iframe').count(),0,'background page closed');
  const acts=await pg.$$eval('#homeHub .ihub-acts a',a=>a.map(x=>[x.textContent,x.getAttribute('href')]));
  assert(acts.some(a=>/發摘要|Send summary/.test(a[0])&&/ac_sec_commute_v2\.html\?tg=summary&ptype=month&period=2026-09/.test(a[1])),'summary action for commute 2026-09: '+JSON.stringify(acts));
  assert(acts.some(a=>/核可|Approval/.test(a[0])&&/ac_sec_commute_v2\.html\?tg=approval&ptype=month&period=2026-09/.test(a[1])),'approval action because a dispatch sheet was imported: '+JSON.stringify(acts));
  if(process.env.SHOT_DIR)await pg.screenshot({path:path.join(process.env.SHOT_DIR,'hub-home-commute.png'),fullPage:true});
  /* ② 同檔再丟 → 已匯入過，不勾選；勾回去重匯 → 0 重複 */
  await pg.click('#homeHub [data-clear]');await pg.setInputFiles('#homeHub [data-file]',[carFile,bikeFile,gateFile,lateFile].map(F));
  await pg.waitForFunction(()=>HOME_HUB.items.length===4&&HOME_HUB.items.every(it=>it.state!=='detect'),null,{timeout:60000});
  items=await pg.evaluate(()=>HOME_HUB.items.map(it=>({name:it.name,state:it.state,on:it.on,tool:it.tool,kind:it.kind})));
  assert(items.every(x=>x.state==='done-before'&&!x.on),'same content → already imported, unticked: '+JSON.stringify(items));
  for(let i=0;i<4;i++)await pg.locator('#homeHub [data-on]').nth(i).check();  /* 每勾一個會重畫，所以逐個取 */
  await pg.click('#homeHub [data-run]');await pg.waitForFunction(()=>!HOME_HUB.busy,null,{timeout:240000});
  const after=await pg.evaluate(async()=>({car:(await SEC.dbGet('ac_sec_car_db',[])).length,bike:(await SEC.dbGet('ac_sec_bike_db',[])).length,gate:(await SEC.dbGet('ac_sec_gate_db',[])).length,late:(await SEC.dbGet('ac_sec_late_db',[])).length}));
  assert.deepEqual(after,{car:car.length,bike:bike.length,gate:gate.length,late:late.length},'re-import does not duplicate any of the four kinds');
  /* ③ 發摘要 → 通勤頁開 Telegram 視窗，期間已預選 */
  await pg.goto('https://offline.test/ac_sec_commute_v2.html?tg=summary&ptype=month&period=2026-09');
  await pg.waitForSelector('.tg-mask #tgAnchor',{timeout:30000});
  assert.equal(await pg.inputValue('.tg-mask #tgType'),'month');assert.equal(await pg.inputValue('.tg-mask #tgAnchor'),'2026-09');
  const prev=await pg.textContent('.tg-mask #tgPreview');assert(/2AB-1234|Tola|Sok Dara/.test(prev),'preview has imported data: '+prev.slice(0,300));
  await pg.click('.tg-mask [data-tg-close]');
  /* ④ 頁首 ⇧：本頁模組直接在本頁匯入（不開背景頁） */
  assert(await pg.isVisible('#btnHub'),'⇧ button fixed in the header');
  await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  const gate2=write('Gate log Oct 2026.xlsx',[{name:'Gate',rows:[['Date','No','Plate','Driver name','Passenger','Dept','Pax','Time in','Time out','Purpose'],['2026-10-02',1,'2EF-9012','Menghorng','Phary','HRA',1,'09:00','11:30','Labour office']]}]);
  await pg.setInputFiles('.hub-mask [data-file]',[F(gate2)]);await pg.waitForFunction(()=>document.querySelector('.hub-mask [data-run]')&&!document.querySelector('.hub-mask [data-run]').disabled);
  const live=await pg.evaluate(()=>document.querySelector('.hub-mask').__hub.items.map(it=>({tool:it.tool,kind:it.kind,state:it.state})));assert.deepEqual(live,[{tool:'commute',kind:'gate',state:'ready'}],'English gate sheet detected on the page hub: '+JSON.stringify(live));
  await pg.click('.hub-mask [data-run]');await pg.waitForFunction(()=>document.querySelector('.hub-mask .ihub-row.ok')&&!document.querySelector('.hub-mask').__hub.busy,null,{timeout:120000});
  assert.equal(await pg.locator('iframe').count(),0,'same-module import runs in the page itself');
  assert.equal(await pg.evaluate(()=>GATE.filter(r=>r.plate==='2EF-9012'&&r.date==='2026-10-02').length),1,'live page data updated');
  await pg.click('.hub-mask [data-close]');
  /* ⑤ 報告：📝 → 產生 Word */
  await pg.evaluate(()=>SEC.Report.open({tool:'commute',ptype:'month',period:'2026-09'}));await pg.waitForSelector('[data-go]');
  assert.equal(await pg.inputValue('[data-period]'),'2026-09');
  assert.equal(await pg.$$eval('[data-scope] option',o=>o.length),5,'scope options (all/vehicle/bike/gate/late)');
  const pv=await pg.textContent('[data-preview]');assert(/通勤|Commute/.test(pv)&&/Tola|2AB-1234|Sok Dara|派車|Trips/.test(pv),'preview from the same summary logic: '+pv.slice(0,200));
  const [dl]=await Promise.all([pg.waitForEvent('download',{timeout:60000}),pg.click('[data-go]')]);
  const docxPath=path.join(process.env.SHOT_DIR||tmp,dl.suggestedFilename());await dl.saveAs(docxPath);
  assert.match(dl.suggestedFilename(),/^VRT_commute_Monthly_2026-09_zh-en\.docx$/);assert(fs.statSync(docxPath).size>5000);
  const docText=require('child_process').execFileSync('python3',['-c','import zipfile,sys,re;print(re.sub(r"<[^>]+>"," ",zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode()))',docxPath]).toString();
  assert(/通勤交通/.test(docText)&&/Commute/.test(docText)&&/Monthly Report/.test(docText),'title in both languages');
  assert(/Executive Summary/.test(docText)&&/Period Comparison/.test(docText)&&/Details/.test(docText)&&/Prepared by/.test(docText),'sections');
  assert(/2AB-1234/.test(docText)&&/Sok Dara/.test(docText)&&/Tola/.test(docText),'detail rows (gate, late, dispatch) in the Word');
  assert(/Vehicle trips/.test(docText)&&/Gate log entries/.test(docText)&&/Late arrivals/.test(docText),'KPI rows in the comparison table');
  await pg.click('[data-close]');
  /* en：介面無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.click('#btnHub');await pg.waitForSelector('.hub-mask [data-drop]');
  let txt=await pg.evaluate(()=>document.querySelector('.hub-mask').innerText);assert(!CJK.test(txt),'hub en: '+txt);await pg.click('.hub-mask [data-close]');
  await pg.evaluate(()=>SEC.Report.open({tool:'commute'}));await pg.waitForSelector('[data-go]');txt=await pg.evaluate(()=>document.querySelector('[data-go]').closest('.modal').innerText);
  assert(!CJK.test(txt.replace(/中文 \+ English/,'')),'report modal en: '+txt);
  const pvEn=await pg.textContent('[data-preview]');assert(!CJK.test(pvEn),'en-km preview has no Chinese: '+pvEn.slice(0,200));
  await pg.click('[data-close]');await pg.evaluate(()=>SEC.setLang('zh'));
  /* ⑥ 首頁丟照片 → 依檔名判成 遲到 → 交棒到通勤頁 → 開辨識視窗 → 儲存 */
  await pg.goto('https://offline.test/index.html');await pg.waitForSelector('#homeHub [data-drop]');
  await pg.setInputFiles('#homeHub [data-file]',[F(pngFile)]);
  await pg.waitForFunction(()=>HOME_HUB.items.length===1&&HOME_HUB.items[0].state!=='detect');
  let ph=await pg.evaluate(()=>{const it=HOME_HUB.items[0];return {tool:it.tool,kind:it.kind,state:it.state,on:it.on,photo:it.photo};});
  assert.deepEqual(ph,{tool:'commute',kind:'late',state:'ready',on:true,photo:true},'photo kind guessed from the file name: '+JSON.stringify(ph));
  await Promise.all([pg.waitForURL(/ac_sec_commute_v2\.html/,{timeout:60000}),pg.click('#homeHub [data-run]').then(()=>pg.waitForFunction(()=>!HOME_HUB.busy&&HOME_HUB.items[0].state==='ok')).then(async()=>{ph=await pg.evaluate(()=>({state:HOME_HUB.items[0].state,msg:HOME_HUB.items[0].msg}));assert.match(ph.msg,/通勤頁|Commute page/,'handoff message: '+JSON.stringify(ph));})]);
  await pg.waitForSelector('#mCommuteOcr.on',{timeout:60000});
  await pg.waitForSelector('#mCommuteOcr .ocr-record',{timeout:60000});
  assert.equal(ocrCalls,1,'OCR called once with the dropped photo');
  assert.equal(await pg.$$eval('#mCommuteOcr .ocr-record',r=>r.length),1,'one recognised record shown for review');
  assert.equal(await pg.inputValue('#mCommuteOcr .ocr-record [data-f="name"]'),'Meas Sokha');
  assert.equal(new URL(pg.url()).search,'','?hub=1 cleaned so reload does not re-run');
  assert(!(await pg.evaluate(()=>SEC.dbGet(SEC.ImportHub.HANDOFF_KEY,null))),'handoff consumed');
  await pg.click('#commuteOcrSaveBtn');await pg.waitForFunction(()=>!document.getElementById('mCommuteOcr')||!document.getElementById('mCommuteOcr').classList.contains('on'));
  const late2=await pg.evaluate(()=>LATE.filter(r=>r.name==='Meas Sokha'&&r.date==='2026-09-15'));assert.equal(late2.length,1,'OCR record saved into the late register: '+JSON.stringify(late2));
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log('PASS: smart import hub × commute — four Excel kinds auto-detected (car/bike/gate/late), background import via the page\'s own importers + cloud wait, summary + approval actions, same content = already imported, re-import no duplicates, "send summary" opens the Telegram modal, header ⇧ imports live, Word report with KPIs/details, en without Chinese, photo handoff → OCR modal → saved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
