/* 2026-10-02 Telegram 群組摘要格式：手機一眼看懂、不靠空白對齊。
   對每個模組 × 語言(zh/both/en/km) × 日/月 × 有無明細，從真正的 Telegram 視窗取預覽，檢查：
   - 沒有空白補齊的表格（行中間連續 3 個以上空白）
   - en / km 沒有中文；both 模式沒有殘留合併標記、沒有整行「中文 / 英文」重複
   - 每頁 ≤ 3800 字；第一頁 ≤ 30 行 */
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {load}=require('./dom-harness.cjs');
const FX=path.join(__dirname,'..','tools','fixtures');
const CJK=/[㐀-鿿]/;
const CASES=[
 ['ac_sec_commute_v2.html','commute.js',['openCommuteTelegram'],['2026-10-01','2026-10']],
 ['ac_sec_attendance_v2.html','attendance.js',['openAttendanceTelegram'],['2026-09-15','2026-09']],
 ['ac_sec_personnel_v1.html','personnel.js',['openPersonnelTelegram'],['2026-09-15','2026-09']],
 ['ac_sec_expense_v1.html','expense.js',['openExpenseTelegram'],['2026-09-01','2026-09']],
 ['ac_sec_fire_v1.html','fire.js',['openFireInspectionTelegram','openFireStatusTelegram'],['2026-09-12','2026-09']],
 ['ac_sec_cctv_v2.html','cctv.js',['openCctvTelegram'],['2026-09-30','2026-09']],
 ['ac_sec_patrol_v2.html','patrol.js',['openPatrolTelegram','openPatrolNightTelegram'],['2026-09-19','2026-09']],
 ['ac_sec_container_v2.html','container.js',['openContainerTelegram'],['2026-09-28','2026-09']],
];
function plain(html){return html.replace(/<br>/g,'\n').replace(/<[^>]+>/g,'').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');}
(async()=>{
 let n=0;
 for(const [page,fx,openers,periods] of CASES){
  const {w,errors,dom}=await load(page);assert.deepEqual(errors,[],page);
  w.eval(fs.readFileSync(path.join(FX,fx),'utf8'));
  for(const opener of openers)for(const period of periods)for(const details of [false,true])for(const lang of ['zh','both','en','km']){
   w.document.querySelectorAll('.tg-mask').forEach(m=>m.remove());w.eval(opener+'()');
   const q=s=>w.document.querySelector('.tg-mask '+s),day=period.length===10;
   q('#tgType').value=day?'day':'month';q('#tgType').onchange();q('#tgAnchor').value=period;q('#tgAnchor').onchange();
   if(page.includes('personnel')&&q('#tgScope')){q('#tgScope').value='allChanges';q('#tgScope').onchange();}
   if(details){const cb=q('#tgDetails');if(cb){cb.checked=true;cb.onchange();}}
   q('#tgLang').value=lang;q('#tgLang').onchange();
   const txt=plain(q('#tgPreview').innerHTML),tag=page+' '+opener+' '+period+' '+lang+(details?' +details':'');
   assert(!/^⚠️ /.test(txt)||!/Error|undefined/.test(txt),tag+': preview error '+txt.slice(0,200));
   const pages=txt.split(/\n\n(?=【\d+\/\d+】)/);
   pages.forEach((pg,i)=>{assert(pg.length<=3800,tag+' page '+(i+1)+' too long '+pg.length);});
   assert(pages[0].split('\n').length<=32,tag+': first page has '+pages[0].split('\n').length+' lines');
   txt.split('\n').forEach(line=>{
     assert(!/\S {3,}\S/.test(line),tag+': padded table line: "'+line+'"');
     assert(!/[⟦⟧]/.test(line),tag+': merge marker left: '+line);
     assert(!/undefined|NaN|\[object Object\]/.test(line),tag+': bad value: '+line);
   });
   if(lang==='en'||lang==='km'){const m=txt.match(/.{0,20}[㐀-鿿].{0,20}/);assert(!m,tag+': Chinese in '+lang+': '+(m&&m[0]));}
   if(lang==='both'){
     /* a whole line duplicated as "中文 … / English …" with the same numbers on both sides means the label merge failed */
     txt.split('\n').forEach(line=>{const parts=line.split(' / ');if(parts.length===2&&CJK.test(parts[0])&&!CJK.test(parts[1])){const d0=(parts[0].match(/\d+/g)||[]).join(','),d1=(parts[1].match(/\d+/g)||[]).join(',');assert(!(d0&&d0===d1&&d0.length>2),tag+': duplicated bilingual line: '+line);}});
   }
   n++;
  }
  dom.window.close();
 }
 console.log('PASS: '+n+' Telegram previews: no padded tables, no Chinese in en/km, clean bilingual merge, pages within limits');
})().catch(e=>{console.error('FAIL:',e&&e.stack||e);process.exit(1);});
