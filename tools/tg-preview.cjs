/* usage: node preview.cjs <page.html> <setupJsFile> <openerFn> [ptype period scope details langs] */
const path=require('path');const {load}=require(path.join(__dirname,'..','tests','dom-harness.cjs'));
const fs=require('fs');
(async()=>{
 const [page,setup,opener,ptype='month',period='2026-09',scope='',details='0',langs='zh,both,en,km']=process.argv.slice(2);
 const {w,errors,dom}=await load(page); if(errors.length)console.log('ERRORS',errors);
 w.eval(fs.readFileSync(setup,'utf8'));
 for(const lang of langs.split(',')){
  w.document.querySelectorAll('.tg-mask').forEach(m=>m.remove());
  w.eval(opener+'()');
  const q=s=>w.document.querySelector('.tg-mask '+s);
  q('#tgType').value=ptype;q('#tgType').onchange();
  const a=q('#tgAnchor'); a.value= ptype==='month'?period.slice(0,7):period; a.onchange();
  if(scope&&q('#tgScope')){q('#tgScope').value=scope;q('#tgScope').onchange();}
  if(details==='1'){const cb=q('#tgDetails');cb.checked=true;cb.onchange();}
  q('#tgLang').value=lang;q('#tgLang').onchange();
  const html=q('#tgPreview').innerHTML;
  const txt=html.replace(/<blockquote[^>]*>/g,'┃ ').replace(/<\/blockquote>/g,'').replace(/<br>/g,'\n').replace(/<[^>]+>/g,'').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
  console.log('\n===== '+lang+' / '+ptype+' '+period+(details==='1'?' +details':'')+' ('+txt.length+' chars) =====\n'+txt);
 }
 dom.window.close();
})();
