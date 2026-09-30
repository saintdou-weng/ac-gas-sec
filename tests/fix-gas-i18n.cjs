/* GAS Telegram / document i18n: every bot message, button label and generated approval document
   must be single-language in the recipient's language (zh / en / km). Run: node tests/fix-gas-i18n.cjs */
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {runtime}=require('./backend.cjs');
const CJK=/[\u3400-\u9fff\uf900-\ufaff]/,KHMER=/[\u1780-\u17ff]/,FULLW=/[：（）；，、。]/;
let pass=0;const ok=m=>{pass++;console.log('PASS: '+m);};
/* Language pickers (繁中 / English / ខ្មែរ) intentionally name each language in its own script. */
const isPicker=b=>/^(bl:|lang_)/.test(b.callback_data||'');
const labels=kb=>kb&&kb.inline_keyboard?[].concat(...kb.inline_keyboard).filter(b=>!isPicker(b)).map(b=>b.text):[];
const cbData=kb=>kb&&kb.inline_keyboard?[].concat(...kb.inline_keyboard).map(b=>b.callback_data||b.url||''):[];
function check(lang,text,what){
  text=String(text);
  if(lang==='en'||lang==='km'){
    const m=text.match(CJK);assert(!m,`${what} [${lang}] contains Chinese "${m&&text.slice(Math.max(0,m.index-20),m.index+20)}"`);
    const f=text.match(FULLW);assert(!f,`${what} [${lang}] contains full-width punctuation "${f&&text.slice(Math.max(0,f.index-20),f.index+20)}"`);
  }
  if(lang==='km')assert(KHMER.test(text),`${what} [km] has no Khmer`);
  if(lang==='zh')assert(CJK.test(text),`${what} [zh] has no Chinese`);
}
function checkMsg(lang,msg,what){check(lang,msg.text,what);assert(msg.text.length<4096,what+' too long');for(const l of labels(msg.keyboard))check('btn-'+lang,l,what+' button "'+l+'"');}
/* Buttons may legitimately be emoji/number-only (e.g. "✅1", "📊 Excel"): only forbid Chinese in en/km buttons. */
const _check=check;check=function(lang,text,what){if(/^btn-/.test(lang)){if(lang!=='btn-zh')assert(!CJK.test(text),what+' contains Chinese');return;}return _check(lang,text,what);};

function setup(){
  const r=runtime('2026-09-05T01:15:00Z'),c=r.c,photos=[],edits=[],sheets=[];
  r.props.APPROVERS='900';r.props.CHAT_ID='-100';
  c.tgPhoto=(chat,photo,caption,kb)=>{photos.push({chat,caption,keyboard:kb});return {message_id:500+photos.length};};
  c.tgEdit=(chat,id,text,kb)=>{edits.push({chat,id,text,keyboard:kb});return true;};
  c.tgSendLong=(chat,text,kb)=>c.tgSend(chat,text,kb);
  /* Fake Sheets / Drive so generateBatchDoc runs and we can inspect every written cell. */
  c.SpreadsheetApp={create(name){const rows=[];let sheetName='';const rng={setFontWeight(){return rng;},setFontSize(){return rng;},setBackground(){return rng;},setFontColor(){return rng;},setValues(v){rows.push(...v);return rng;}};
    const sh={setName(n){sheetName=n;},appendRow(a){rows.push(a);},getLastRow(){return rows.length;},getRange(){return rng;},setFrozenRows(){},autoResizeColumns(){}};
    const ss={getActiveSheet:()=>sh,getId:()=>'SS1',getUrl:()=>'https://docs.google.com/spreadsheets/d/SS1'};sheets.push({name,rows,get sheetName(){return sheetName;}});return ss;}};
  c.DriveApp={getFileById:()=>({setSharing(){}}),Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1}};
  return {r,c,photos,edits,sheets};
}
const fee=(n,extra)=>({key:'fee-'+n,id:'SF-'+n,dept:'Security Fee',name:'Guard service '+n,amount:100+n,date:'2026-09-0'+n,vendor:'VendorCo',qty:1,unit:'month',reason:'monthly fee',info:'invoice',photos:['data:image/png;base64,AAA'+n],...extra});
const cq=(data,text,extra)=>({id:'cq1',data,message:{chat:{id:'-100'},message_id:1,text:text||''},from:{id:'900',first_name:'Paul'},...extra});

/* 1. Approval batch message, keyboard, language switching, review, result and generated document */
{
  const kbs={};
  for(const lang of ['zh','en','km']){
    const {r,c,photos,edits,sheets}=setup();
    const res=c.createApprovalBatch({module:'expense',period:'2026-09',lang,items:[fee(1),fee(2),fee(3,{name:''})]});
    const m=r.messages[0];checkMsg(lang,m,'approval request');kbs[lang]=cbData(m.keyboard);
    if(lang==='zh')assert(!/\b(Field|Records|Pending|Photos|Category|Vendor|Amount)\b/.test(m.text),'zh approval table must not force English headers');
    if(lang!=='zh')assert(/(Records|កំណត់ត្រា)/.test(m.text));
    assert(photos.length>=3);photos.forEach(p=>check(lang,p.caption,'approval photo caption'));
    const b=JSON.parse(r.disk['batch_'+res.batchId+'.json']);
    /* review (stage 1) → answer + private notice to approver */
    c.handleCallback(cq('bv:'+res.batchId));check(lang,c.answer,'review answer');
    const dm=r.messages.find(x=>x.chat==='900');checkMsg(lang,dm,'approver notice');
    checkMsg(lang,edits[edits.length-1],'batch after review');
    assert(/(Reviewed|已審查|បានត្រួតពិនិត្យ)/.test(edits[edits.length-1].text));
    /* decision + approve all + close → result + document */
    c.handleCallback(cq('ap:'+b.items[0].token+':T'));check(lang,c.answer,'decision answer');
    c.handleCallback(cq('ba:'+res.batchId));c.handleCallback(cq('bc:'+res.batchId));
    const result=r.messages[r.messages.length-1];checkMsg(lang,result,'batch result');
    const sheet=sheets[0];assert(sheet,'document generated');
    const cells=sheet.rows.flat().filter(v=>typeof v==='string'&&v).join(' | ')+' | '+sheet.sheetName;
    if(lang==='zh')assert(!/\b(Approval Document|Status|Category|Vendor|Reviewer)\b/.test(cells),'zh document must not force English headers');
    else {assert(!CJK.test(cells),'document ['+lang+'] contains Chinese: '+cells.match(/.{0,20}[\u3400-\u9fff].{0,20}/));}
    if(lang==='km'){assert(KHMER.test(cells));assert(cells.includes('កាលបរិច្ឆេទ')&&cells.includes('រយៈពេល'));}
    /* document generation failure message */
    const f=setup();f.c.SpreadsheetApp={create(){throw Error('quota');}};
    const res2=f.c.createApprovalBatch({module:'expense',period:'2026-09',lang,items:[fee(4)]});f.c.handleCallback(cq('bc:'+res2.batchId));
    const fail=f.r.messages[f.r.messages.length-1];checkMsg(lang,fail,'doc failure result');assert(/(failed|失敗|បរាជ័យ)/.test(fail.text));
  }
  assert.deepEqual(kbs.en,kbs.zh,'callback_data unchanged across languages');assert.deepEqual(kbs.km,kbs.zh);
  ok('approval batch message / keyboard / photo captions / review / decision / result / generated document are single-language in zh, en, km');
}
/* 1b. In-message language switch renders all three languages on the same batch */
{
  const {r,c,edits}=setup();const res=c.createApprovalBatch({module:'expense',period:'2026-09',lang:'zh',items:[fee(1)]});
  for(const lang of ['en','km','zh']){c.handleCallback(cq('bl:'+res.batchId+':'+lang));checkMsg(lang,edits[edits.length-1],'switched batch ('+lang+')');}
  assert(!r.messages[0].text.includes('ដំណាក់កាល:'),'period is រយៈពេល');
  const km=edits[0].text;/* first switch was en */ const kmEdit=edits[1].text;assert(kmEdit.includes('រយៈពេល'),'km period label');
  ok('setBatchLang (bl:) switching re-renders zh/en/km correctly; km period = រយៈពេល');
}
/* 2. Reports: anomaly, dashboard, patrol status, night patrol, pending, cloud status, monthly summary, /sec menu */
{
  for(const lang of ['zh','en','km']){
    const {r,c}=setup();
    /* data: overdue + pile-up + data issue batch, patrol night shortage, open patrol issue, over-budget month */
    const items=[];for(let i=1;i<=21;i++)items.push(fee(i%9+1,{key:'k'+i,id:i===2?'':'SF'+i}));
    c.createApprovalBatch({module:'expense',period:'2026-09',lang:'zh',items});
    const idx=r.props.batch_index.split(',');const b=JSON.parse(r.disk['batch_'+idx[0]+'.json']);b.createdAt='2026-08-20T00:00:00Z';b.items[0].status='approved';r.disk['batch_'+idx[0]+'.json']=JSON.stringify(b);
    r.props['budget_2026-09']='10';
    r.disk['patrol.json']=JSON.stringify({records:[{date:'2026-09-04',time:'23:10',location:'Gate A'}]});
    c.handlePatrolIssue({lang,title:'Broken fence',location:'Gate B',shift:'Night',level:'urgent',reporter:'Sok',detail:'x',photos:['p1']});
    const issueMsg=r.messages[r.messages.length-1];checkMsg(lang,issueMsg,'patrol issue (urgent, approver copy)');
    r.messages.length=0;
    c.sendAnomalyReport('-100',lang);const an=r.messages.pop();checkMsg(lang,an,'anomaly report');
    for(const s of ['Overdue','Pile-up','Night patrol shortage','Patrol issues','Over budget','Budget'])if(lang==='en')assert(an.text.includes(s),'anomaly en has '+s);
    if(lang==='km')for(const s of ['ហួសកំណត់','លើសថវិកា','ថវិកា','ល្បាតយប់មិនគ្រប់'])assert(an.text.includes(s),'anomaly km has '+s);
    c.sendDashboard('-100',lang);checkMsg(lang,r.messages.pop(),'dashboard');
    c.sendPatrolStatus('-100',lang);checkMsg(lang,r.messages.pop(),'patrol status');
    c.checkNightPatrol('-100',lang);const np=r.messages.pop();checkMsg(lang,np,'night patrol check');assert(np.text.includes('22:00'));
    r.disk['patrol.json']=JSON.stringify({records:[]});c.checkNightPatrol('-100',lang);checkMsg(lang,r.messages.pop(),'night patrol OK');
    c.sendPendingBatches('-100',lang);checkMsg(lang,r.messages.pop(),'pending batches');
    c.sendCloudStatus('-100',lang);checkMsg(lang,r.messages.pop(),'cloud status');
    c.sendMonthlySummary('-100',lang,'2026-09');checkMsg(lang,r.messages.pop(),'monthly summary');
    c.sendSecMenu('-100',lang);const menu=r.messages.pop();checkMsg(lang,menu,'/sec menu');
    /* menu buttons without language in callback_data follow the menu message language */
    const plain=menu.text.replace(/<[^>]+>/g,'');
    for(const k of ['sec_dash','sec_anom','sec_night','sec_pend','sec_status']){c.handleCallback(cq(k,plain));checkMsg(lang,r.messages.pop(),'menu button '+k);}
    /* empty pending */
    const e=setup();e.c.sendPendingBatches('-100',lang);const ep=e.r.messages.pop();checkMsg(lang,ep,'no pending batches');
    e.c.sendAnomalyReport('-100',lang);checkMsg(lang,e.r.messages.pop(),'no anomalies');
  }
  ok('anomaly (逾期未核/天/待核堆積/資料異常/夜巡不足/巡邏待處理/件未結案/超預算/預算), dashboard, patrol overview, night patrol, pending, cloud status, monthly summary, /sec menu + its buttons are single-language');
}
/* 3. Container live text, photo captions, QR notice, patrol issue closed, reminders, commands, errors */
{
  for(const lang of ['zh','en','km']){
    const {r,c,photos}=setup();
    const rec={id:'CT1',date:'2026-09-05',containerNo:'MSCU123',truckNo:'3A-1234',name:'Dara',licence:'L9',company:'ACME',timeIn:'08:30',signIn:'Sok',isImport:true,isExport:true,visitorId:'V1',remark:'ok'};
    check(lang,c.containerLiveText_(rec,'entry',lang),'container entry text');
    const done=c.containerLiveText_({...rec,timeOut:'10:00',signOut:'Vuth'},'exit',lang);check(lang,done,'container exit text');
    if(lang==='km')assert(done.includes('កាលបរិច្ឆេទ'));
    c.handleContainerLiveUpdate({record:rec,phase:'entry',lang,photos:['c1','c2']});checkMsg(lang,r.messages.pop(),'container live message');
    photos.forEach(p=>check(lang,p.caption,'container photo caption'));
    const fail=setup();fail.c.tgPhoto=()=>null;const out=fail.c.handleContainerLiveUpdate({record:rec,phase:'entry',lang,photos:['c9']});check(lang,out.error,'container photo failure error');
    /* QR push notice */
    c.qrTokenFor=()=>({tool:'container',token:'T',period:'2026-09',periodType:'month',mode:'truck',id:'C1',expiresAt:'',openCount:0});
    c.qrRecordInScope=()=>true;c.qrPeriodMatch=()=>true;c.saveCloudPayload=()=>({updated:1,added:2});c.markDispatchUpdate_=()=>({});
    c.qrPush({token:'T',notify:true,operator:'Sok',lang,records:[{id:'C1',date:'2026-09-05'}]});checkMsg(lang,r.messages.pop(),'QR update notice');
    /* patrol issue closed — explicit lang, and fallback to the language the issue was reported in */
    c.handlePatrolIssue({lang,title:'Door',location:'Gate'});
    const id=JSON.parse(r.disk['patrol_issues.json'])[0].id;r.messages.length=0;
    c.doPost({postData:{contents:JSON.stringify({action:'closeIssue',id,by:'web'})}});checkMsg(lang,r.messages.pop(),'patrol issue closed (issue lang)');
    c.handlePatrolIssue({lang:'zh',title:'Door2'});const id2=JSON.parse(r.disk['patrol_issues.json'])[0].id;
    c.doPost({postData:{contents:JSON.stringify({action:'closeIssue',id:id2,lang})}});checkMsg(lang,r.messages.pop(),'patrol issue closed (body lang)');
    /* monthly reminder in the group's default language */
    const m=setup();m.r.props.GROUP_LANG=lang;m.c.monthlyCompleteness=ym=>({ym,cloudMissing:['patrol'],summaryMissing:['cctv'],approvalMissing:['expense'],feeData:true});
    assert(m.c.pendingDispatchReminderJob().sent);const rem=m.r.messages.pop();checkMsg(lang,rem,'monthly reminder');assert(rem.text.includes('2026-08'));
    /* commands in group default language */
    const g=setup();g.r.props.GROUP_LANG=lang;
    for(const cmd of ['/sec','/status','/dashboard','/anomaly','/pending','/summary','/patrol','/night','/id','/myid']){
      g.c.handleTgWebhookUpdate({message:{chat:{id:'-100'},from:{id:'900'},text:cmd}});checkMsg(lang,g.r.messages.pop(),'command '+cmd);}
    g.c.handleCallback(cq('selftest',g.c.L3(lang,'測試','test','សាកល្បង')));check(lang,g.c.answer,'selftest answer');
    /* errors returned to the web page */
    const e=setup();e.c.createApprovalBatch({module:'expense',period:'2026-09',lang,items:[fee(1)]});
    const b=JSON.parse(e.r.disk['batch_'+e.r.props.batch_index.split(',')[0]+'.json']);e.c.applyDecision(b.items[0].token,'A','900','Paul');
    assert.throws(()=>e.c.createApprovalBatch({module:'expense',period:'2026-09',lang,items:[fee(1)]}),err=>{check(lang,err.message,'already-approved error');return true;});
    assert.throws(()=>e.c.handleTgSummaryBatch_({lang,pages:Array.from({length:25},()=>({text:'x'}))}),err=>{check(lang,err.message,'>24 pages error');return /24/.test(err.message);});
    e.r.setLocked(true);check(lang,e.c.handleTgSummaryBatch_({lang,pages:[{text:'x'}]}).error,'summary busy error');e.r.setLocked(false);
    /* summary photo caption uses the module name in the summary language */
    const s=setup();s.c.handleTgSummary({text:'x',module:'container',lang,photos:['s1']});check(lang,s.photos[0].caption,'summary photo caption');
    /* legacy default report title */
    const l=setup();require('vm').runInContext('LEGACY.cctv({lang:'+JSON.stringify(lang)+'})',l.c);check(lang,l.r.messages.pop().text,'legacy CCTV default title');
  }
  ok('container live text + captions + errors, QR notice, patrol issue closed, monthly reminder, bot commands (/sec /status /dashboard /anomaly /pending /summary /patrol /night /id /myid), selftest, web-facing errors and legacy titles are single-language');
}
/* 4. Khmer terminology in the dictionary */
{
  const {c}=setup();assert.equal(c.t('km','period'),'រយៈពេល');assert.equal(c.L3('km','中','EN',''),'EN','km falls back to English, never Chinese');assert.equal(c.L3('both','中','EN','ខ'),'中');
  assert.equal(c.msgLang_({text:'Select Module:'}),'en');assert.equal(c.msgLang_({text:'ជ្រើសរើស'}),'km');assert.equal(c.msgLang_({text:'請選擇'}),'zh');
  ok('Khmer period = រយៈពេល; L3 km→en fallback; message-language detection for callbacks');
}
/* 5. Static scan: CJK literals that can still reach en/km output (informational list + guard on builders) */
{
  const src=fs.readFileSync(path.join(__dirname,'../ac_sec.gs'),'utf8');
  const zhOnly=new Array(src.length).fill(false);
  /* mark first/zh argument of L3(lang, zh, …) and D/X/L3-style local helpers (zh, en, km) as zh-only */
  const call=/\b(L3|D|X)\(/g;let mm;
  while((mm=call.exec(src))){let i=mm.index+mm[0].length,depth=0,arg=0,q=null,start=i;const want=mm[1]==='L3'?1:0;
    for(;i<src.length;i++){const ch=src[i];if(q){if(ch==='\\'){i++;continue;}if(ch===q)q=null;continue;}
      if(ch==="'"||ch==='"'||ch==='`'){q=ch;continue;}if('([{'.includes(ch))depth++;else if(')]}'.includes(ch)){if(depth===0)break;depth--;}
      else if(ch===','&&depth===0){if(arg===want)for(let k=start;k<i;k++)zhOnly[k]=true;arg++;start=i+1;}}
    if(arg===want)for(let k=start;k<i;k++)zhOnly[k]=true;}
  /* zh: keys, I18N.zh block, owner-only admin/log helpers */
  const lines=src.split('\n');let off=0,fn='';const left=[];
  const ADMIN=/^(INSTALL|DIAGNOSE|一鍵安裝|清理孤立觸發器|更新|重置|修復|查帳本|解除已核可|清空帳本|設定|停用|診斷|測試|修正|查看|ensure|setupWebhook|I18N)/;
  const inI18nZh=(()=>{const a=src.indexOf('const I18N = {'),b=src.indexOf('\n  en:',a);return i=>i>a&&i<b;})();
  lines.forEach((ln,li)=>{const f=ln.match(/^function (\S+?)\s*\(/);if(f)fn=f[1];if(/^const I18N/.test(ln))fn='I18N';
    const re=/'((?:\\.|[^'\\])*)'/g;let s;while((s=re.exec(ln))){const pos=off+s.index;if(!CJK.test(s[1]))continue;
      const before=ln.slice(0,s.index);if(ln.trim().startsWith('//')||ln.trim().startsWith('/*')||ln.trim().startsWith('*')||/\/\*[^*]*$/.test(before)||/\/\/.*$/.test(before))continue;
      const kmTernaryElse=/lang\w*\s*===?\s*'km'\s*\?\s*'(?:[^'\\]|\\.)*'\s*:\s*$/.test(before);   /* en ? … : km ? … : 中文 */
      const picker=s[1]==='繁中';                                                                /* language picker label */
      const triArray=/\w+\s*:\s*\[\s*$/.test(before);                                            /* key:['中文','English','ខ្មែរ'] tables */
      if(kmTernaryElse||picker||triArray||zhOnly[pos]||inI18nZh(pos)||/\bzh\s*:\s*$/.test(before)||ADMIN.test(fn)||/Logger\.log|say\(|console\./.test(before))continue;
      left.push({line:li+1,fn,v:s[1].slice(0,60)});}
    off+=ln.length+1;});
  const OWN=['stageLine','renderBatchText','renderBatchKeyboard','sendBatchPhotos_','handleCallback','generateBatchDoc','sendBatchResult','sendPendingBatches','summaryKeyboard','containerLiveText_','handleContainerLiveUpdate','collectAnomalies','sendAnomalyReport','checkNightPatrol','handlePatrolIssue','sendPatrolStatus','sendDashboard','sendMonthlyCompletenessReport','sendMonthlySummary','sendSecMenu','sendCloudStatus','qrPush','handleTgSummaryBatch_','createApprovalBatch'];
  const bad=left.filter(x=>OWN.includes(x.fn));
  console.log('INFO: CJK literals not guarded by a zh branch ('+left.length+'):');left.forEach(x=>console.log('  '+x.line+' '+x.fn+' '+JSON.stringify(x.v)));
  assert.deepEqual(bad,[],'user-facing builders still contain unguarded Chinese');
  ok('static scan: no unguarded Chinese literal left in user-facing message builders');
}
console.log(`ALL ${pass} GAS i18n checks passed`);
