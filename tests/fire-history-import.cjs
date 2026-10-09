// 2026-10-09 消防「匯入歷史月檢表」：只寫巡檢歷史，不動設備總表；中英文分頁名、標題月份、重匯不重複
const assert=require('assert/strict');const {load}=require('./dom-harness.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));const CJK=/[㐀-鿿]/;
(async()=>{
 const p=await load('ac_sec_fire_v1.html'),w=p.w;assert.deepEqual(p.errors,[]);
 try{
  let synced=[];w.SEC.scheduleAutoCloudSync=(t,r,k)=>synced.push([t,r,k]);
  w.DB=[{id:'F1',code:'FE01',type:'ext',factory:'a',zone:'bldA',loc:'Gate A',cycle:30,last:'2026-01-01',status:'ok',photos:[]}];w.HIST=[];w.ASSET_CHANGES=[];
  const dbBefore=JSON.stringify(w.DB),acBefore=JSON.stringify(w.ASSET_CHANGES);
  const sheets=[
   {name:'滅火器',fileName:'月檢表.xlsx',rows:[['VRT 滅火器月檢表 2026年8月'],['No','Code','Location','Expire Date','Checked by','Result','Remarks'],[1,'FE01','Gate A',46500,'Sok','✓',''],[2,'FE02','Canteen',46500,'Sok','X','pressure low']]},
   {name:'Smoke Detector',fileName:'月檢表.xlsx',rows:[['Smoke detector check'],['Code','Date Check','Checked by','Status'],['F001','05/09/2026','Dara','OK'],['F002','05/09/2026','Dara','OK'],['F003','','Dara','OK']]},
   {name:'緊急照明',fileName:'月檢表.xlsx',rows:[['Emergency light'],['Code','Checked by'],['EL01','Sok']]},
   {name:'Notes',rows:[['hello']]}];
  const run=()=>{w.SEC.pickExcel=cb=>cb(copy(sheets));w.impHistExcel();};
  run();
  assert.equal(JSON.stringify(w.DB),dbBefore,'equipment master untouched');assert.equal(JSON.stringify(w.ASSET_CHANGES),acBefore,'no asset change records');
  const H=w.HIST.map(h=>({date:h.date,by:h.by,n:h.n,bad:h.bad,codes:h.items.map(i=>i.code).join(',')}));
  assert.equal(JSON.stringify(H),JSON.stringify([{date:'2026-09-05',by:'Dara',n:2,bad:0,codes:'F001,F002'},{date:'2026-08-01',by:'Sok',n:2,bad:1,codes:'FE01,FE02'}]),'two batches by date; title month used when no date column; row without date skipped');
  const fe01=w.HIST[1].items.find(i=>i.code==='FE01');assert.equal(fe01.id,'F1','linked to the existing device');assert.equal(fe01.zone,'bldA');
  assert.equal(w.HIST[1].items.find(i=>i.code==='FE02').result,'fault');
  assert(synced.some(s=>s[1]==='fire-history-import'&&s[2]==='2026-08')&&synced.some(s=>s[2]==='2026-09'),'each month synced');
  const log=w.document.getElementById('impLog').textContent;assert.match(log,/緊急照明/);assert.match(log,/2026-08/);
  run();assert.equal(w.HIST.length,2,'re-import replaces the same batches');assert.equal(JSON.stringify(w.DB),dbBefore);
  // buttons + en text
  w.SEC.setLang('en');const btn=w.document.querySelector('button[onclick="impHistExcel()"]');assert(btn);
  w.SEC.applyLang&&w.SEC.applyLang();assert(!CJK.test(btn.textContent)||btn.querySelector('span').getAttribute('data-en')==='Import past monthly checks');
  w.HIST=[];w.SEC.pickExcel=cb=>cb([{name:'Notes',rows:[['x']]}]);w.impHistExcel();assert.equal(w.HIST.length,0);
  console.log('PASS: fire history import → HIST only (master/asset changes untouched), zh/en tab names, title month fallback, device link, fault rows, per-month sync, re-import no duplicates');
 }finally{p.dom.window.close();}
})().catch(e=>{console.error(e);process.exit(1);});
