// 2026-11-11 Paul：資料沒上雲就不准發到群組，並在畫面上通知；上雲成功後照常發。真 Chromium＋真 .gs。
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');const {runtime}=require('./backend.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const cloud=runtime(new Date().toISOString());let block=false;
 const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  await ctx.route('**/*',async r=>{const req=r.request(),u=new URL(req.url());
   if(u.hostname==='offline.test'){const p=path.join(root,decodeURIComponent(u.pathname));if(fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({status:200,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});return r.fulfill({status:404,body:''});}
   if(u.hostname==='script.google.com'){
    if(req.method()==='POST'){const body=req.postData()||'{}';let a='';try{a=JSON.parse(body).action||'';}catch(_){}
     if(block&&!/^telegram/.test(a))return r.abort('failed');/* 雲端存檔失敗，但 Telegram 那條路還通 */
     return r.fulfill({status:200,contentType:'application/json',body:cloud.c.doPost({postData:{contents:body}}).text});}
    if(block)return r.abort('failed');
    return r.fulfill({status:200,contentType:'application/json',body:cloud.c.doGet({parameter:Object.fromEntries(u.searchParams)}).text});}
   return r.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{destroy(){} update(){}};'});});
  const pg=await ctx.newPage(),errors=[];pg.on('pageerror',e=>errors.push(e.message));pg.on('dialog',d=>d.accept());
  await pg.goto('https://offline.test/ac_sec_patrol_v2.html');await pg.waitForFunction(()=>window.SEC&&typeof MAN!=='undefined'&&document.getElementById('pcDate'));
  await pg.evaluate(()=>SEC.setLang('en'));await pg.waitForTimeout(2500);
  const today=await pg.evaluate(()=>SEC.ymd());
  /* ① 雲端壞掉時存一筆 → 未上雲 → 發摘要被擋、畫面通知、群組沒收到 */
  block=true;
  await pg.evaluate(d=>{MAN.push({id:'m-c1',date:d,time:'22:10',shift:'N',guard:'Guard A',location:'Yard',status:'ok',note:'',photos:[],updatedAt:new Date().toISOString()});saveMan();rebuild();SEC.scheduleAutoCloudSync('patrol','record-save',d);},today);
  await pg.waitForFunction(()=>SEC.cloudPending('patrol'));
  const n0=cloud.messages.length;
  await pg.goto('https://offline.test/ac_sec_patrol_v2.html?tg=summary&ptype=day&period='+today+'&lang=en&autosend=1');
  await pg.waitForFunction(()=>window.__AC_AUTOSEND&&/^(sent|error|skipped)$/.test(window.__AC_AUTOSEND.state),null,{timeout:90000});
  let res=await pg.evaluate(()=>window.__AC_AUTOSEND);
  assert.equal(res.state,'error','blocked while not in cloud: '+JSON.stringify(res));assert(/cloud/i.test(res.reason),res.reason);
  assert.equal(cloud.messages.length,n0,'nothing reached the group');
  const toast=await pg.evaluate(()=>[...document.querySelectorAll('.toast')].map(x=>x.innerText).join(' | '));
  assert(/Not saved to cloud yet/.test(toast)&&/Upload now/.test(toast),'on-screen notice with Upload now: '+toast);
  assert.equal((toast.match(/Not saved to cloud yet/g)||[]).length,1,'notice shown once');
  assert(!/[㐀-鿿]/.test(toast),'en notice has no Chinese');
  /* ② 雲端恢復 → 送出前自動補傳 → 照常發 */
  block=false;
  await pg.goto('https://offline.test/ac_sec_patrol_v2.html?tg=summary&ptype=day&period='+today+'&lang=en&autosend=1');
  await pg.waitForFunction(()=>window.__AC_AUTOSEND&&/^(sent|error|skipped)$/.test(window.__AC_AUTOSEND.state),null,{timeout:90000});
  res=await pg.evaluate(()=>window.__AC_AUTOSEND);
  assert.equal(res.state,'sent','sends once the cloud save works: '+JSON.stringify(res));assert(cloud.messages.length>n0,'summary reached the group');
  assert.deepEqual(errors,[]);
  console.log('PASS: not in cloud → summary blocked, one on-screen notice with Upload now, nothing sent; cloud back → auto-upload first, then sent');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
