const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.SEC_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process'],headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname==='offline.test'){
   const p=path.join(root,u.pathname);if(fs.existsSync(p)&&fs.statSync(p).isFile())return route.fulfill({status:200,contentType:p.endsWith('.html')?'text/html':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'application/octet-stream',body:fs.readFileSync(p)});
  }return route.fulfill({status:200,contentType:'application/javascript',body:'window.Chart=class{destroy(){} update(){}};'});});
  await page.goto('https://offline.test/ac_sec_commute_v2.html');await page.evaluate(()=>openCommuteTelegram());
  const approve=page.locator('[data-tg-mode="approval"]');assert(!(await approve.isVisible()));
  await page.selectOption('#tgScope','vehicle');assert(await approve.isVisible());await approve.click();
  await page.selectOption('#tgScope','bike');assert(!(await approve.isVisible()));assert((await page.locator('[data-tg-mode="summary"]').getAttribute('class')).includes('on'));
  await page.goto('https://offline.test/ac_sec_fire_v1.html');await page.evaluate(()=>{
    DB=[{id:'E1',code:'FE06',type:'ext',factory:'a',zone:'bldA',loc:'Inside the front wall of Building A',status:'fault'}];
    HIST=[{id:'H1',date:'2026-09-12',by:'Jenny',items:[{...DB[0],result:'fault',note:'Low pressure',photos:['fault-photo']}]}];PER=new SEC.Period('month',new Date(2026,8,12));openFireInspectionTelegram();
  });
  const preview=await page.locator('#tgPreview').innerText();assert(preview.includes('FE06')&&preview.includes('Inside the front wall of Building A'));assert(!preview.includes('Location/位置'));
  assert(!(await page.locator('[data-tg-mode="approval"]').count()));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile has no horizontal overflow');
  assert.deepEqual(errors,[]);
  console.log('PASS: Chromium mobile scope switching, hidden approval controls, bilingual fire preview and no horizontal overflow');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
