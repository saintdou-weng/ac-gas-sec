// 2026-11-11 手機精簡清單（shared/sec-compact.js，仿 VRT HR 員工頁）：消防設備清單＋保安人員名冊。
// 手機：一筆一行、按鈕收進「⋯」、點一行開詳細卡（n/總數、◀ ▶、編輯按原本那顆）、選取模式；電腦寬度：完全不啟用。
const fs=require('fs'),path=require('path'),assert=require('assert/strict');const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');
const root=path.join(__dirname,'..');
(async()=>{const cloud=runtime(new Date().toISOString());const b=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
 async function ctxOf(w,h,mobile){const ctx=await b.newContext({viewport:{width:w,height:h},hasTouch:mobile,isMobile:mobile});
  await ctx.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());
   if(u.hostname==='offline.test'){const p=path.join(root,decodeURIComponent(u.pathname));if(fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({status:200,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});return r.fulfill({status:404,body:''});}
   if(u.hostname==='script.google.com'){let o;if(req.method()==='POST')o=cloud.c.doPost({postData:{contents:req.postData()||'{}'}}).text;else o=cloud.c.doGet({parameter:Object.fromEntries(u.searchParams)}).text;return r.fulfill({status:200,contentType:'application/json',body:o});}
   return r.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{destroy(){} update(){}};'});});return ctx;}
 try{
  const ctx=await ctxOf(390,844,true),pg=await ctx.newPage(),errs=[];pg.on('pageerror',e=>errs.push(e.message));pg.on('dialog',d=>d.accept());
  await pg.goto('https://offline.test/ac_sec_fire_v1.html');await pg.waitForFunction(()=>window.SEC&&typeof DB!=='undefined'&&document.querySelector('#tbList tr td.cmp-main'));
  const n=await pg.evaluate(()=>DB.length);assert(n>50);
  const rowH=await pg.evaluate(()=>document.querySelector('#tbList tr').getBoundingClientRect().height);assert(rowH<80,'one compact line per device: '+rowH);
  assert.equal(await pg.evaluate(()=>[...document.querySelectorAll('#p-list h3 .sp > button:not(.cmp-more)')].filter(x=>x.offsetParent).length),0,'toolbar buttons folded away');
  assert(!(await pg.isVisible('#p-list .fire-master-tools')),'master tools folded away');
  assert.match(await pg.textContent('#p-list .cmp-count'),new RegExp('^'+n+' '));
  await pg.fill('#q','FE0');await pg.waitForTimeout(150);const f=await pg.evaluate(()=>document.querySelectorAll('#tbList tr td.cmp-main').length);assert(f>0&&f<n,'search still filters and rows are repainted: '+f);await pg.fill('#q','');
  /* 工具選單 → 按原本的按鈕 */
  await pg.click('.cmp-more');await pg.waitForSelector('.cmp-sheet');const items=await pg.$$eval('.cmp-sheet .cmp-item',x=>x.map(y=>y.textContent.trim()));
  assert(items.length>=7&&items.some(t=>/新增/.test(t))&&items.some(t=>/QR/.test(t))&&items.some(t=>/選取多筆/.test(t)),JSON.stringify(items));
  await pg.click('.cmp-sheet .cmp-item:first-of-type');await pg.waitForFunction(()=>document.getElementById('mEdit').classList.contains('on'));assert(!(await pg.$('.cmp-mask')));await pg.evaluate(()=>fireCloseEdit());
  /* 詳細卡 */
  const PX='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await pg.evaluate(px=>{const e=fireVisibleList()[2];e.photos=[px];HIST.push({id:'Ht1',date:'2026-10-29',by:'Jenny',items:[{id:e.id,code:e.code,type:e.type,result:'ok',note:''}]},{id:'Ht2',date:'2026-09-12',by:'Phea',items:[{id:e.id,code:e.code,type:e.type,result:'fault',note:'No pressure',due:'2026-09-18',done:'2026-09-20',photos:[px]}]},{id:'Ht3',date:'2026-08-05',by:'Jenny',items:[{id:e.id,code:e.code,type:e.type,result:'ok',note:''}]});renderAll();},PX);
  await pg.click('#tbList tr:nth-child(3) td.cmp-main');await pg.waitForSelector('.cmp-drawer');
  assert.equal(await pg.textContent('.cmp-nav .cnt'),'3/'+n);const code=await pg.evaluate(()=>fireVisibleList()[2].code);assert((await pg.textContent('.cmp-nav .now')).includes(code));
  assert((await pg.$$eval('.cmp-rec[data-k="2"] .cmp-kv dt',x=>x.map(y=>y.textContent))).length>=9,'all columns listed');
  /* 往下滑＝下一筆：上面的計數跟著變，滑回來也會變回來 */
  assert.equal(await pg.$$eval('.cmp-rec',x=>x.length),n,'one card per record in a single scrolling feed');
  const h=await pg.evaluate(()=>{const b=document.querySelector('.cmp-db'),r=b.querySelector('.cmp-rec[data-k="6"]');b.scrollTop=r.offsetTop;return 1;});await pg.waitForFunction(x=>document.querySelector('.cmp-nav .cnt').textContent==='7/'+x,n);
  const code7=await pg.evaluate(()=>fireVisibleList()[6].code);assert((await pg.textContent('.cmp-nav .now')).includes(code7),'header follows the card in view');
  await pg.evaluate(()=>{const b=document.querySelector('.cmp-db'),r=b.querySelector('.cmp-rec[data-k="2"]');b.scrollTop=r.offsetTop;});await pg.waitForFunction(x=>document.querySelector('.cmp-nav .cnt').textContent==='3/'+x,n);
  /* 分頁：現況／歷史紀錄／異常／照片（把現在跟歷史分開） */
  assert.deepEqual(await pg.$$eval('.cmp-tabs button',x=>x.map(y=>y.dataset.tab)),['info','hist','bad','photo']);
  const hc=await pg.evaluate(()=>fireDeviceHistory(fireVisibleList()[2]).length);assert(hc>=3);assert((await pg.textContent('.cmp-tabs [data-tab="hist"]')).includes(String(hc)));assert.match(await pg.textContent('.cmp-tabs [data-tab="bad"]'),/[1-9]/);assert.match(await pg.textContent('.cmp-tabs [data-tab="photo"]'),/[2-9]/);
  await pg.click('.cmp-tabs [data-tab="hist"]');let hb=await pg.evaluate(()=>document.querySelector('.cmp-rec[data-k="2"] .cmp-body').innerText);
  assert(/2026-10-29/.test(hb)&&/2026-09-12/.test(hb)&&/2026-08-05/.test(hb)&&/No pressure/.test(hb)&&/Jenny/.test(hb),'history lists every inspection: '+hb);assert(hb.indexOf('2026-10-29')<hb.indexOf('2026-08-05'),'newest first');
  assert.equal(await pg.textContent('.cmp-nav .cnt'),'3/'+n,'stays on the same device after switching tab');
  assert(!/No pressure/.test(await pg.evaluate(()=>document.querySelector('.cmp-rec[data-k="3"] .cmp-body').innerText)),'other devices show their own history');
  await pg.click('.cmp-tabs [data-tab="bad"]');hb=await pg.evaluate(()=>document.querySelector('.cmp-rec[data-k="2"] .cmp-body').innerText);assert(/2026-09-12/.test(hb)&&/No pressure/.test(hb)&&/完成 2026-09-20/.test(hb)&&!/2026-08-05\n/.test(hb.replace(/最近[^\n]*/,'')),'faults only: '+hb);
  await pg.click('.cmp-tabs [data-tab="photo"]');assert((await pg.$$eval('.cmp-rec[data-k="2"] .cmp-body img',x=>x.length))>=2,'equipment photo + inspection photo');
  await pg.click('.cmp-rec[data-k="2"] .cmp-body img');assert(await pg.evaluate(()=>[...document.querySelectorAll('.mask.on img')].length>0),'photo opens large');await pg.evaluate(()=>document.querySelectorAll('body > .mask.on').forEach(m=>{if(!m.id)m.remove();}));
  await pg.click('.cmp-tabs [data-tab="info"]');assert((await pg.$$eval('.cmp-rec[data-k="2"] .cmp-kv dt',x=>x.length))>=9);
  await pg.click('.cmp-nav [data-step="1"]');assert.equal(await pg.textContent('.cmp-nav .cnt'),'4/'+n);await pg.waitForTimeout(700);
  await pg.keyboard.press('ArrowLeft');assert.equal(await pg.textContent('.cmp-nav .cnt'),'3/'+n);await pg.waitForTimeout(700);
  await pg.click('.cmp-rec[data-k="2"] [data-act="0"]');await pg.waitForFunction(()=>document.getElementById('mEdit').classList.contains('on'));
  assert((await pg.textContent('#mTitle')).includes(code),'edit opens the same device');await pg.evaluate(()=>fireCloseEdit());
  /* 選取模式 */
  await pg.click('.cmp-more');await pg.click('.cmp-sheet [data-sel]');assert(await pg.isVisible('.cmp-selbar.on'));
  await pg.click('#tbList tr:nth-child(1) td.cmp-main');await pg.click('#tbList tr:nth-child(2) td.cmp-main');assert.equal(await pg.evaluate(()=>document.querySelectorAll('#tbList .fire-select:checked').length),2);assert(!(await pg.$('.cmp-drawer')),'tap selects instead of opening');
  await pg.click('.cmp-selbar [data-k="done"]');assert.equal(await pg.evaluate(()=>document.querySelectorAll('#tbList .fire-select:checked').length),0);assert.equal(await pg.evaluate(()=>DB.length),n,'nothing deleted');
  /* en 無中文 */
  await pg.evaluate(()=>SEC.setLang('en'));await pg.waitForTimeout(300);await pg.click('.cmp-more');assert(!/[㐀-鿿]/.test(await pg.evaluate(()=>document.querySelector('.cmp-sheet').innerText)));await pg.mouse.click(195,30);
  await pg.click('#tbList tr:nth-child(1) td.cmp-main');assert(!/[㐀-鿿]/.test(await pg.evaluate(()=>document.querySelector('.cmp-drawer').innerText)),'en drawer');await pg.click('.cmp-nav [data-x]');
  /* 保安人員名冊 */
  await pg.goto('https://offline.test/ac_sec_personnel_v1.html');await pg.waitForFunction(()=>window.SEC&&typeof DB!=='undefined'&&document.getElementById('tbRos'));
  await pg.evaluate(()=>{for(let i=1;i<=5;i++)DB.push({id:'p'+i,empId:'S0'+i,name:'Guard '+i,position:'Security Guard',shift:'ABC'[i%3],post:'Gate',joinDate:'2024-01-01',phone:'012',status:'active'});renderAll();});
  await pg.waitForSelector('#tbRos tr td.cmp-main');await pg.click('#tbRos tr:nth-child(2) td.cmp-main');await pg.waitForSelector('.cmp-drawer');assert.equal(await pg.textContent('.cmp-nav .cnt'),'2/5');
  assert(/Guard/.test(await pg.textContent('.cmp-nav .now')));await pg.click('.cmp-nav [data-x]');assert.deepEqual(errs,[]);await ctx.close();
  /* 電腦：不啟用 */
  const d=await ctxOf(1280,800,false),dp=await d.newPage();await dp.goto('https://offline.test/ac_sec_fire_v1.html');await dp.waitForFunction(()=>window.SEC&&typeof DB!=='undefined'&&document.querySelector('#tbList tr'));await dp.waitForTimeout(300);
  assert.equal(await dp.evaluate(()=>document.querySelectorAll('.cmp-card,.cmp-table,td.cmp-main').length),0,'desktop untouched');assert(await dp.isVisible('#p-list .fire-master-tools'));
  console.log('PASS: compact phone list (fire equipment + security roster): one line per record, tools folded into ⋯, detail card with n/total ◀ ▶ and original edit, select mode, search repaint, en without Chinese, desktop untouched');
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1);});
