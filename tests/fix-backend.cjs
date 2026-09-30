/* Regression tests for the 20260929 backend fix sprint (ac_sec.gs).
   Self-contained GAS harness with a fake Drive folder so the real loadDrive/saveDrive,
   backup, cleanup and smart-sync code paths run. Run: node tests/fix-backend.cjs */
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.join(__dirname,'..'),SRC=fs.readFileSync(path.join(ROOT,'ac_sec.gs'),'utf8');
const PAUL='5026942575',RANDOM='111',PHEA='222',CHAT='-5009220114',EXEC='https://script.google.com/macros/s/TESTDEPLOY/exec';
const BASE='https://saintdou-weng.github.io/ac-gas-sec';
let failures=0;const pass=m=>console.log('PASS: '+m);
async function section(name,fn){try{await fn();pass(name);}catch(e){failures++;console.log('FAIL: '+name+'\n'+(e&&e.stack||e));}}
function iter(a){let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};}
function formatDate(d,tz,fmt){const f=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});const p=Object.fromEntries(f.formatToParts(d).map(x=>[x.type,x.value]));return fmt.replace(/yyyy|MM|dd|HH|H|mm|ss|d/g,k=>({yyyy:p.year,MM:p.month,dd:p.day,HH:p.hour,H:String(+p.hour),mm:p.minute,ss:p.second,d:String(+p.day)}[k]));}
function rt(initial='2026-09-14T01:00:00Z',opt={}){
 let clock=Date.parse(initial),locked=false,docs=0,hookUrl='',blobReads=0;
 const props={},disk={},mt={},messages=[],edits=[],photos=[],answers=[],fetches=[],trashed=[],cache={},triggers=opt.triggers||['pendingDispatchReminderJob','monthlySummaryJob'];
 class Clock extends Date{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
 const store={getProperty:k=>Object.prototype.hasOwnProperty.call(props,k)?props[k]:null,
  setProperty:(k,v)=>{v=String(v);if(Buffer.byteLength(v)>9216)throw Error('Argument too large: value ('+k+')');props[k]=v;return store;},
  deleteProperty:k=>{delete props[k];return store;},getProperties:()=>({...props})};
 function file(map,name){return {getName:()=>name,getId:()=>'id:'+name,getBlob:()=>({getDataAsString:()=>{blobReads++;return map[name];}}),
  setContent:t=>{map[name]=String(t);mt[name]=clock;},setTrashed:()=>{delete map[name];trashed.push(name);},getLastUpdated:()=>new Date(mt[name]||0),isTrashed:()=>false};}
 function folder(map,name){const subs={};return {getId:()=>'f:'+name,getName:()=>name,isTrashed:()=>false,
  getFilesByName:n=>iter(Object.prototype.hasOwnProperty.call(map,n)?[file(map,n)]:[]),getFiles:()=>iter(Object.keys(map).map(n=>file(map,n))),
  searchFiles:q=>{const m=/title contains '([^']*)'/.exec(q),p=m?m[1]:'';return iter(Object.keys(map).filter(n=>n.indexOf(p)>=0).map(n=>file(map,n)));},
  createFile:(n,c)=>{map[n]=String(c);mt[n]=clock;return file(map,n);},getFoldersByName:n=>iter(subs[n]?[subs[n]]:[]),createFolder:n=>(subs[n]=folder({},n)),_subs:subs,_map:map};}
 const root=folder(disk,'AC_SEC_Data');
 const resp=(code,obj)=>({getResponseCode:()=>code,getContentText:()=>typeof obj==='string'?obj:JSON.stringify(obj)});
 const ctx=vm.createContext({Date:Clock,console:{log(){},error(){},warn(){}},Logger:{log(){}},PropertiesService:{getScriptProperties:()=>store},
  Utilities:{formatDate,sleep(){},getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},Charset:{UTF_8:'utf8'},
   computeDigest:(alg,str)=>Array.from(crypto.createHash(alg).update(str).digest()),base64EncodeWebSafe:arr=>Buffer.from(arr).toString('base64url')},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},waitLock:()=>{if(locked)throw Error('busy');locked=true;},releaseLock:()=>{locked=false;},hasLock:()=>locked})},
  CacheService:{getScriptCache:()=>({get:k=>cache[k]||null,put:(k,v)=>{cache[k]=String(v);}})},
  DriveApp:{getFolderById:()=>root,getFoldersByName:()=>iter([root]),createFolder:()=>root,getRootFolder:()=>root},MimeType:{PLAIN_TEXT:'text/plain'},
  HtmlService:{createHtmlOutput:t=>({text:String(t)})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  ScriptApp:{getProjectTriggers:()=>triggers.map(h=>({getHandlerFunction:()=>h})),getService:()=>({getUrl:()=>EXEC}),deleteTrigger(){},
   newTrigger:h=>{const ch={timeBased:()=>ch,everyDays:()=>ch,atHour:()=>ch,onMonthDay:()=>ch,inTimezone:()=>ch,create:()=>{triggers.push(h);return ch;}};return ch;}},
  SpreadsheetApp:{create(){docs++;throw Error('no sheets in test');}},
  UrlFetchApp:{fetch:(url,o={})=>{fetches.push({url,o});
   if(url.indexOf(EXEC)===0)return (o.method||'get')==='post'?resp(200,'AC_SEC_WEBHOOK_OK'):resp(200,{ok:true,data:{ok:true}});
   const m=/\/bot([^/]*)\/(\w+)$/.exec(url);if(!m||!m[1])return resp(404,{ok:false,description:'Not Found'});
   const body=o.payload&&typeof o.payload==='string'?JSON.parse(o.payload):{};
   if(m[2]==='setWebhook'){hookUrl=body.url;return resp(200,{ok:true,result:true});}
   if(m[2]==='getWebhookInfo')return resp(200,{ok:true,result:{url:hookUrl,pending_update_count:0}});
   if(m[2]==='getMe')return resp(200,{ok:true,result:{id:1,username:'ac_sec_bot'}});
   if(m[2]==='getChat')return resp(200,{ok:true,result:{id:CHAT,title:'AC SEC Group'}});
   if(m[2]==='getChatMember')return resp(200,{ok:true,result:{status:'administrator'}});
   if(m[2]==='sendMessage'){messages.push({chat:String(body.chat_id),text:body.text,kb:body.reply_markup,api:true});return resp(200,{ok:true,result:{message_id:messages.length,chat:{id:body.chat_id}}});}
   return resp(200,{ok:true,result:true});}}});
 vm.runInContext(SRC,ctx);
 ctx.tgSend=(chat,text,kb)=>{messages.push({chat:String(chat),text:String(text||''),kb});return {message_id:messages.length,chat:{id:String(chat)}};};
 ctx.tgEdit=(chat,id,text,kb)=>{edits.push({chat,id,text,kb});return true;};
 ctx.tgPhoto=(chat,p,cap)=>{photos.push({chat,p,cap});return {message_id:900+photos.length};};
 ctx.answerCb=(id,text)=>{answers.push(String(text||''));};
 const post=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}).text);
 const get=p=>JSON.parse(ctx.doGet({parameter:p}).text);
 const cb=(data,uid,key,upd)=>{const u={update_id:upd||Math.floor(Math.random()*1e9),callback_query:{id:'q',data,message:{chat:{id:CHAT},message_id:77,text:'x'},from:{id:uid,first_name:'U'+uid}}};
  ctx.doPost({parameter:key===undefined?{}:{k:key},postData:{contents:JSON.stringify(u)}});return answers[answers.length-1];};
 return {c:ctx,props,disk,mt,messages,edits,photos,answers,fetches,trashed,root,post,get,cb,run:s=>vm.runInContext(s,ctx),
  setDate:s=>{clock=Date.parse(s);},advance:ms=>{clock+=ms;},setLocked:v=>{locked=v;},isLocked:()=>locked,docs:()=>docs,hook:()=>hookUrl,blobReads:()=>blobReads};
}
const clone=x=>JSON.parse(JSON.stringify(x));
const fee=(key,amt,extra={})=>({key,id:extra.id||key,name:'Security Service Fee '+key,dept:'Security Fee',amount:amt,date:'2026-09-01',...extra});
function batchOf(r,id){return JSON.parse(r.disk['batch_'+id+'.json']);}
/* Emulates the browser smart-sync client (same bucket/hash rules as shared/sec-smart-sync.js). */
function clientPush(r,tool,records,extra,base,opt={}){
 const c=r.c,groups={};records.forEach((x,i)=>{const k=c.secPersonnelBucket_(tool,x,i);(groups[k]||(groups[k]=[])).push(x);});
 if(extra&&Object.keys(extra).length)groups.__extra=[{__smartExtra:true,extra}];
 const uploadId='sec_'+r.c.Date.now().toString(36)+'_'+crypto.randomBytes(3).toString('hex'),hashes=Object.assign({},base||{}),counts={};
 for(const k of Object.keys(groups)){const pk=c.secSmartBucketPack_(groups[k]);hashes[k]=pk.hash;counts[k]=pk.rows.length;
  if(!base||base[k]!==pk.hash)r.post({action:'smartBucket',tool,uploadId,bucket:k,hash:pk.hash,count:pk.rows.length,records:clone(pk.rows)});}
 if(opt.stageOnly)return {uploadId,hashes,counts};
 return r.post({action:'smartCommit',tool,uploadId,hashes,counts,recordCount:records.length,meta:{tool,periods:[]}});
}
function liveRows(r,tool){return (r.c.pullPayload(tool).records||[]).filter(x=>x&&!x._deleted);}

(async()=>{
/* ───────── #1 Token ───────── */
await section('#1 token: kept only in private GAS (never in public files), changed token stored once, missing token stops deployment with instructions',()=>{
 /* Owner decision 2026-09-29: keep the existing bot token in the PRIVATE GAS file; it must never be in public front-end files. */
 assert.match(SRC,/BOT_TOKEN\s*:\s*'\d+:[\w-]+',/);
 for(const f of require('fs').readdirSync(path.join(__dirname,'..','shared')).filter(n=>n.endsWith('.js')).map(n=>'shared/'+n).concat(require('fs').readdirSync(path.join(__dirname,'..')).filter(n=>n.endsWith('.html'))))
   assert(!/\d{8,}:AA[\w-]{30,}/.test(require('fs').readFileSync(path.join(__dirname,'..',f),'utf8')),'bot token leaked into public file '+f);
 const r=rt(),logs=[];r.run("SETUP.BOT_TOKEN='123:NEWTOKEN'");
 assert.equal(r.c.secApplySetupToken_(s=>logs.push(s)),true);assert.equal(r.props.BOT_TOKEN,'123:NEWTOKEN');assert(logs.includes('✅ 已換新 Bot Token'));
 logs.length=0;assert.equal(r.c.secApplySetupToken_(s=>logs.push(s)),true);assert.equal(logs.length,0,'same token is not re-announced');
 const out=r.c.更新部署連線();assert(out.indexOf('123:NEWTOKEN')<0,'token never printed');assert(out.includes('✅ Webhook 網址核對一致（含安全金鑰）'),out);
 const n=rt();n.run("SETUP.BOT_TOKEN=''");const o2=n.c.更新部署連線();assert(o2.includes('⛔ 找不到 Bot Token'));assert.equal(n.fetches.length,0,'stops before any network call');
 const i2=n.c.INSTALL();assert(i2.includes('⛔ 找不到 Bot Token'));assert.equal(n.fetches.length,0);
});

/* ───────── #2 Webhook secret ───────── */
await section('#2 webhook ?k= secret: setWebhook uses key, forged/keyless updates ignored, probe still works, comparisons strip key, no other decision path',()=>{
 const r=rt();r.props.BOT_TOKEN='123:T';
 const res=r.c.setupWebhook(false);assert(res.ok);const key=r.props.WEBHOOK_KEY;assert.match(key,/^[0-9a-f]{32}$/);
 assert.equal(r.hook(),EXEC+'?k='+key);assert(r.c.secWebhookMatches_(r.hook(),EXEC));assert(!r.c.secWebhookMatches_(EXEC,EXEC));assert(!r.c.secWebhookMatches_(EXEC+'?k=wrong',EXEC));
 assert.equal(r.c.secStripWebhookKey_(EXEC+'?k=abc'),EXEC);assert.equal(r.c.secStripWebhookKey_(EXEC+'?a=1&k=abc'),EXEC+'?a=1');assert(!r.c.secMaskUrl_(r.hook()).includes(key));
 assert.equal(r.c.setupWebhook(false).ok,true);assert.equal(r.props.WEBHOOK_KEY,key,'key generated once');
 assert.equal(r.c.doPost({postData:{contents:JSON.stringify({__sec_webhook_probe:true})}}).text,'AC_SEC_WEBHOOK_OK');
 let handled=0;const real=r.c.handleTgWebhookUpdate;r.c.handleTgWebhookUpdate=u=>{handled++;return real(u);};
 const b=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('F1',100)]}),before=r.disk['batch_'+b.batchId+'.json'];
 r.cb('ba:'+b.batchId,PAUL);r.cb('ba:'+b.batchId,PAUL,'wrong-key');assert.equal(handled,0,'forged/keyless updates never reach the handler');assert.equal(r.disk['batch_'+b.batchId+'.json'],before);
 r.cb('ba:'+b.batchId,PAUL,key);assert.equal(handled,1);assert.equal(batchOf(r,b.batchId).items[0].status,'approved');
 const d=r.c.DIAGNOSE();assert(d.includes('✅ 2/5 Webhook 網址正確（含安全金鑰）'),d);assert(!d.includes(key),'diagnose output (sent to group) never contains the key');
 r.run("UrlFetchApp.fetch(TG()+'/setWebhook',{method:'post',payload:JSON.stringify({url:'"+EXEC+"'})})");assert(r.c.DIAGNOSE().includes('NOKEY'));
 // Only the Telegram callback handler may record approval decisions.
 const callers=name=>SRC.split('\n').filter(l=>new RegExp('\\b'+name+'\\(').test(l)&&!new RegExp('function '+name+'\\(').test(l));
 for(const fn of ['applyDecision','approveAllPending','closeBatch'])for(const l of callers(fn))assert(/const r = (applyDecision|approveAllPending|closeBatch)\(/.test(l),fn+' called outside handleCallback: '+l.trim());
 assert(!/case 'approve'|action === 'approve'|action==='approve'/.test(SRC));
});

/* ───────── #3 Reviewer / approver ───────── */
await section('#3 anyone may review; only APPROVERS approve/reject/approve-all/close; non-approver gets refusal and nothing changes',()=>{
 const r=rt();r.props.WEBHOOK_KEY='K';
 const b=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('F1',100),fee('F2',200)]}),B0=batchOf(r,b.batchId),tok=B0.items[0].token;
 const snap=()=>[r.disk['batch_'+b.batchId+'.json'],r.disk['decided_expense.json']];const s0=snap();
 for(const data of ['ap:'+tok+':A','ap:'+tok+':T','ba:'+b.batchId,'bc:'+b.batchId]){const a=r.cb(data,RANDOM,'K');assert(a.includes('⛔'),data+' → '+a);}
 assert.deepEqual(snap(),s0,'non-approver presses change nothing');
 const m0=r.messages.length;r.cb('bv:'+b.batchId,RANDOM,'K');assert.equal(batchOf(r,b.batchId).stage,'approve','REVIEWERS empty = anyone may review');
 assert.equal(r.messages.length,m0+1,'approver notified once');r.cb('bv:'+b.batchId,RANDOM,'K');assert.equal(r.messages.length,m0+1,'double review press → no second notice');
 const e=rt();e.props.WEBHOOK_KEY='K';const b2=e.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('F1',100)]});e.cb('ba:'+b2.batchId,PAUL,'K');assert.equal(batchOf(e,b2.batchId).items[0].status,'approved','Paul may approve during review stage');
 e.props.APPROVERS='';assert.equal(e.c.isApprover(PAUL),true,'empty property falls back to SETUP approvers');assert.equal(e.c.isApprover(RANDOM),false);e.props.APPROVERS=' , ';assert.equal(e.c.isApprover(PAUL),false,'no approver configured → nobody can approve');
});

/* ───────── #4 chatId ignored ───────── */
await section('#4 front-end send actions ignore body.chatId and always use the configured group',()=>{
 const r=rt();const evil='-999';
 assert(r.post({action:'telegram',chatId:evil,text:'hello',module:'fire',mode:'summary',period:'2026-09',periodType:'month'}).data.sent);
 assert(r.post({action:'telegramBatch',chatId:evil,module:'fire',period:'2026-09',periodType:'month',pages:[{text:'p1'},{text:'p2'}]}).data.sent);
 r.post({action:'containerLiveUpdate',chatId:evil,record:{id:'T1',date:'2026-09-14',containerNo:'C1'},phase:'entry'});
 r.post({action:'nightCheck',chatId:evil});r.post({action:'dashboard',chatId:evil});r.post({action:'anomalyReport',chatId:evil});r.post({action:'secMenu',chatId:evil});
 assert(r.messages.length>=7);assert(r.messages.every(m=>m.chat===CHAT),JSON.stringify(r.messages.map(m=>m.chat)));
 const core=fs.readFileSync(path.join(ROOT,'shared/sec-core.js'),'utf8');assert(!/chatId/.test(core),'front end does not send a custom chatId');
});

/* ───────── #5 Backup / notice / restore ───────── */
await section('#5 destructive clear/replace: backup before overwrite (keep 10), group notice with before→after, 還原雲端備份 restores newest backup',()=>{
 const r=rt(),recs=Array.from({length:12},(_,i)=>({id:'E'+i,name:'Item '+i,cat:'Other',amount:i+1,date:'2026-09-'+String(1+i).padStart(2,'0'),updatedAt:'2026-09-14T01:00:00Z'}));
 assert(r.post({action:'push',tool:'expense',syncMode:'merge',records:clone(recs)}).ok);
 assert(clientPush(r,'expense',clone(recs)).ok);assert.equal(liveRows(r,'expense').length,12);
 const m0=r.messages.length;r.advance(60000);
 const tombs=recs.map(x=>({_deleted:true,_recordKey:'expense|id|'+x.id,id:x.id,date:x.date,updatedAt:'2026-09-14T01:05:00Z'}));
 const man=r.get({action:'smartManifest',tool:'expense'}).data;assert(clientPush(r,'expense',tombs,null,man.hashes).ok);
 assert.equal(liveRows(r,'expense').length,0);assert.equal(r.c.getSnap('expense').recordCount,0,'snapshot excludes tombstones');
 const bf=r.root._subs.backup._map,names=Object.keys(bf).filter(n=>/^expense_\d{8}_\d{6}\.json$/.test(n));assert.equal(names.length,1,Object.keys(bf).join());
 const notice=r.messages.slice(m0).find(m=>/12 → 0/.test(m.text));assert(notice,'group notice with before→after');assert(notice.text.includes('還原雲端備份'));
 const out=r.c.還原雲端備份('expense');assert(out.startsWith('✅ 已還原 expense'),out);assert.equal(liveRows(r,'expense').length,12,'restored rows visible to pull');
 const pulled=r.c.pullPayload('expense').records,tomb=Object.fromEntries(tombs.map(t=>[t._recordKey,Date.parse(t.updatedAt)]));
 assert(pulled.every(x=>!x._deleted&&Date.parse(x.updatedAt)>tomb['expense|id|'+x.id]),'restored rows are newer than device tombstones');
 assert(Object.keys(bf).some(n=>/_before-restore\.json$/.test(n)),'current state backed up before restoring');
 // legacy replace path + keep last 10
 const l=rt();for(let i=0;i<13;i++){l.advance(1000);l.post({action:'push',tool:'patrol',syncMode:'merge',records:[{id:'P'+i,date:'2026-09-01',time:'22:00',guard:'G'}]});l.post({action:'push',tool:'patrol',syncMode:'replace',forceReplace:true,confirmReplace:true,records:[]});}
 const lb=Object.keys(l.root._subs.backup._map).filter(n=>/^patrol_/.test(n));assert.equal(lb.length,10,'keep last 10 per tool');
 assert(l.messages.some(m=>/1 → 0/.test(m.text)));assert(l.c.還原雲端備份('patrol').startsWith('✅'));assert.equal(liveRows(l,'patrol').length,1);
 const x=rt();x.post({action:'push',tool:'patrol',syncMode:'replace',records:[]});assert.equal(Object.keys(x.root._subs).length,0,'replace without force+confirm never backs up/replaces');
});

/* ───────── #6 QR → smart storage ───────── */
await section('#6 qrPush merges into smart buckets under lock; qrPull reads current smart equipment list; container QR visible to main platform',()=>{
 const r=rt();const eq=[{id:'FIRE-EXT-A-FE01-GATE',code:'FE01',type:'ext',factory:'a',zone:'gate',loc:'Moved to new gate',last:'2026-08-20',status:'ok'},
  {id:'FIRE-EXT-A-FE02-BLDA',code:'FE02',type:'ext',factory:'a',zone:'bldA',loc:'Kitchen',last:'2026-08-20',status:'ok'}];
 assert(clientPush(r,'fire',clone(eq),{history:[{id:'H0',date:'2026-08-20',items:[{code:'FE01'}]}]}).ok);
 const tok=r.post({action:'qrIssue',tool:'fire',mode:'equipment',id:'FE01',periodType:'month'}).data;
 const pull=r.post({action:'qrPull',tool:'fire',mode:'equipment',token:tok.token}).data;assert.equal(pull.meta.baseline,false);assert.equal(pull.records.length,1);assert.equal(pull.records[0].loc,'Moved to new gate','QR reads current smart equipment, not built-in baseline');
 const up=r.post({action:'qrPush',tool:'fire',mode:'equipment',token:tok.token,operator:'Guard Sok',records:[{...eq[0],last:'2026-09-14',status:'fault',remark:'pressure low',updatedAt:'2026-09-14T01:00:00Z'}],extra:{history:[{id:'H1',date:'2026-09-14',items:[{code:'FE01',r:'fault'}]}]}});
 assert(up.ok,up.error);assert.equal(r.isLocked(),false);
 const all=r.c.pullPayload('fire');const fe01=all.records.filter(x=>x.code==='FE01');assert.equal(fe01.length,1,'no duplicate equipment after bucket move');assert.equal(fe01[0].status,'fault');assert.equal(fe01[0].qrUpdatedBy,'Guard Sok');
 assert.equal(all.records.length,2);assert.deepEqual(clone(all.extra.history.map(h=>h.id).sort()),['H0','H1']);
 assert(!r.disk['fire.json'],'legacy fire.json not used when smart manifest exists');
 const r2=rt();assert(clientPush(r2,'container',[{_k:'truck',id:'T1',date:'2026-09-14',containerNo:'C1',updatedAt:'2026-09-14T00:00:00Z'}]).ok);
 const ct=r2.post({action:'qrIssue',tool:'container',mode:'truck',id:'',periodType:'month'}).data;
 assert(r2.post({action:'qrPush',tool:'container',mode:'truck',token:ct.token,operator:'Gate',records:[{_k:'truck',id:'QR1',date:'2026-09-14',containerNo:'QRC'}]}).ok);
 assert.deepEqual(clone(r2.c.pullPayload('container').records.map(x=>x.id).sort()),['QR1','T1']);
 const man=r2.get({action:'smartManifest',tool:'container'}).data;const rows=Object.keys(man.hashes).flatMap(k=>r2.get({action:'smartBucket',tool:'container',bucket:k}).data.records);assert(rows.some(x=>x.id==='QR1'));
});

/* ───────── #7 Ledgers ───────── */
await section('#7 summary/photo/QR ledgers on Drive: 400 entries each, no property over 9KB, active QR tokens kept, ledger failure never turns a sent message into failure',()=>{
 const r=rt();
 for(let i=0;i<400;i++)r.c.tgSummaryMark_('sig'+i+'x'.repeat(40),{module:'container',period:'2026-09-'+String(1+i%28).padStart(2,'0'),periodType:'day'},1000+i);
 assert(r.c.tgSummaryFind_('sig0'+'x'.repeat(40)),'oldest of 400 still found');assert(r.c.tgSummaryFind_('sig399'+'x'.repeat(40)));
 const st=r.c.tgPhotoState_('container-live:x:entry',Array.from({length:400},(_,i)=>'data:image/jpeg;base64,'+i));st.send.forEach(s=>r.c.tgPhotoCommit_(st,s.key,'ns'));r.c.tgPhotoSave_(st);
 assert.equal(r.c.tgPhotoState_('container-live:x:entry',['data:image/jpeg;base64,0']).send.length,0,'photo dedupe survives 400 entries');
 const first=r.post({action:'qrIssue',tool:'fire',mode:'equipment',id:'FE000',periodType:'month',dynamicPeriod:true}).data;
 for(let i=1;i<400;i++)assert(r.post({action:'qrIssue',tool:'fire',mode:'equipment',id:'FE'+String(i).padStart(3,'0'),periodType:'month',dynamicPeriod:true}).ok);
 assert(r.post({action:'qrPull',tool:'fire',mode:'equipment',token:first.token}).ok,'first of 400 QR tokens still valid');
 for(const k of Object.keys(r.props))assert(Buffer.byteLength(r.props[k])<8000,k+' '+Buffer.byteLength(r.props[k]));
 assert(!r.props.tg_summary_delivery_ledger&&!r.props.tg_photo_delivery_ledger&&!r.props.ac_sec_qr_tokens_v1);
 // legacy property ledgers are migrated on first write
 const m=rt();m.props.tg_summary_delivery_ledger=JSON.stringify([{sig:'old'}]);assert(m.c.tgSummaryFind_('old'));m.c.tgSummaryMark_('new',{module:'fire'},1);assert(m.c.tgSummaryFind_('old')&&!m.props.tg_summary_delivery_ledger);
 // ledger/receipt write failures after a successful send
 const f=rt();const save=f.c.saveDrive;f.c.saveDrive=(n,t)=>{if(/^ledger_/.test(n))throw Error('Drive quota');return save(n,t);};f.c.markTelegramReport_=()=>{throw Error('property full');};
 const out=f.post({action:'telegram',text:'report',module:'fire',mode:'summary',period:'2026-09',periodType:'month',photos:['data:image/jpeg;base64,AA']});assert(out.ok&&out.data.sent,JSON.stringify(out));
 assert(f.post({action:'telegramBatch',module:'fire',period:'2026-09-02',periodType:'day',pages:[{text:'a'}]}).data.sent);
 f.c.saveContainerLiveReceipt_=f.c.saveContainerLiveReceipt_;const big=rt();big.c.P=()=>({getProperty:()=>null,setProperty:()=>{throw Error('quota');},deleteProperty(){}});
 assert(big.post({action:'containerLiveUpdate',record:{id:'T9',date:'2026-09-14',containerNo:'C9'},phase:'entry'}).data.sent,'container receipt failure does not fail the send');
});

/* ───────── #8 Approval contract ───────── */
await section('#8 approval: lock, content hash, closed→new batch, approved+changed→pending, legacy ledger, idempotent close, auto result once, status keyed by key',()=>{
 const r=rt();r.props.WEBHOOK_KEY='K';
 // reject + close → identical resubmission creates a NEW batch with a new message
 const a=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-1',100,{id:'EXP-001'})]});let A=batchOf(r,a.batchId);
 r.cb('ap:'+A.items[0].token+':T',PAUL,'K');A=batchOf(r,a.batchId);assert.equal(A.status,'closed','all decided → auto-closed');
 const resultMsgs=()=>r.messages.filter(m=>/🔒/.test(m.text)).length;assert.equal(resultMsgs(),1,'result sent once automatically');
 r.cb('bc:'+a.batchId,PAUL,'K');r.cb('bc:'+a.batchId,PAUL,'K');assert.equal(resultMsgs(),1,'🔒 after auto-close does not resend');assert.equal(r.docs(),1,'one document attempt');
 const m0=r.messages.length,again=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-1',100,{id:'EXP-001'})]});
 assert.notEqual(again.batchId,a.batchId);assert(!again.reused&&again.messageId);assert(r.messages.length>m0);
 // approve → same content skipped; edited amount → new pending batch
 r.cb('ba:'+again.batchId,PAUL,'K');assert.throws(()=>r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-1',100,{id:'EXP-001'})]}),/already approved|核可過/);
 const edited=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-1',999,{id:'EXP-001'})]});assert.equal(batchOf(r,edited.batchId).items[0].status,'pending');
 const led=JSON.parse(r.disk['decided_expense.json']);assert.equal(led['rec-1'].s,'pending');assert.equal(led['rec-1'].h,batchOf(r,edited.batchId).items[0].h);
 // status keyed by key (record id), display id separate
 const st=r.post({action:'approvalStatus',batchId:again.batchId}).data;assert.equal(st.statuses['rec-1'],'approved');assert.equal(st.items[0].key,'rec-1');assert.equal(st.items[0].id,'EXP-001');
 // same display code reused by a different record does not inherit approval
 const other=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-2',100,{id:'EXP-001'})]});assert.equal(batchOf(r,other.batchId).items[0].status,'pending');
 // legacy ledger entries (old code keys, no hash)
 const l=rt();l.disk['decided_expense.json']=JSON.stringify({'EXP-20260901-002':{s:'approved',b:'OLD',at:'2026-09-01T00:00:00Z'}});
 l.disk['batch_OLD.json']=JSON.stringify({batchId:'OLD',module:'expense',status:'closed',items:[l.c.approvalNormalizeItem_(fee('EXP-20260901-002',300),0,'2026-09')],audit:[]});
 assert(l.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('rec-9',300,{id:'EXP-20260901-002'})]}).batchId,'old code-keyed entry does not block id-keyed item');
 assert.throws(()=>l.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('EXP-20260901-002',300)]}),/already approved|核可過/,'legacy entry with identical content still blocks');
 assert(l.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('EXP-20260901-002',777)]}).batchId,'legacy entry with different content → re-approval');
 // manual 🔒 on an open batch: exactly one result message and document
 const d=rt();d.props.WEBHOOK_KEY='K';const db=d.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('x1',1),fee('x2',2)]});
 d.cb('bc:'+db.batchId,PAUL,'K');d.cb('bc:'+db.batchId,PAUL,'K');assert.equal(d.messages.filter(m=>/🔒/.test(m.text)).length,1);assert.equal(d.docs(),1);
 assert.equal(batchOf(d,db.batchId).audit.filter(x=>x.act==='close').length,1);assert(/closed|關閉/.test(d.cb('ap:'+batchOf(d,db.batchId).items[0].token+':A',PAUL,'K')));
 // superseded: a pending item resent with new content in a new batch
 const s=rt();s.props.WEBHOOK_KEY='K';const s1=s.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('k1',10)]}),oldTok=batchOf(s,s1.batchId).items[0].token;
 const s2=s.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('k1',11)]});assert.notEqual(s1.batchId,s2.batchId);
 assert.equal(batchOf(s,s1.batchId).items[0].status,'superseded');assert.equal(batchOf(s,s1.batchId).status,'closed');
 s.cb('ap:'+oldTok+':A',PAUL,'K');assert.equal(batchOf(s,s2.batchId).items[0].status,'pending','old button cannot approve new content');
 // concurrency: request while lock held fails fast (no batch); nested request during creation cannot create a 2nd batch
 const c=rt();c.setLocked(true);assert.throws(()=>c.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('z',1)]}),/核可請求處理中|approval request/i);c.setLocked(false);
 assert.equal(Object.keys(c.disk).filter(n=>/^batch_/.test(n)).length,0);
 let inner=null;const orig=c.c.loadLedger;let once=true;c.c.loadLedger=m=>{if(once){once=false;try{c.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('z',1)]});}catch(e){inner=e;}}return orig(m);};
 const outer=c.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('z',1)]});assert(inner,'nested request blocked by lock');
 const retry=c.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('z',1)]});assert.equal(retry.batchId,outer.batchId);assert(retry.reused);
 assert.equal(c.messages.filter(m=>/<code>/.test(m.text)&&m.text.includes(outer.batchId)).length,1,'one approval message');
 // audit-C conc.cjs: second create while first is saving
 const q=rt();let inner2=null,once2=true;const sb=q.c.saveBatch;q.c.saveBatch=b=>{if(once2){once2=false;try{inner2=q.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('w',1)]});}catch(e){inner2=e;}}return sb(b);};
 q.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('w',1)]});assert(inner2&&/核可請求處理中/.test(inner2.message),'second request while first is saving is refused');assert.equal(Object.keys(q.disk).filter(n=>/^batch_/.test(n)).length,1);
 // page/lang/review take the lock; busy → no write
 const p=rt();const pb=p.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('p',1)]}),raw=p.disk['batch_'+pb.batchId+'.json'];
 p.setLocked(true);assert.equal(p.c.setBatchPage(pb.batchId,1),null);assert.equal(p.c.setBatchLang(pb.batchId,'en'),null);assert.equal(p.c.reviewBatch_(pb.batchId,'1','x'),null);p.setLocked(false);
 assert.equal(p.disk['batch_'+pb.batchId+'.json'],raw);assert.equal(p.c.setBatchLang(pb.batchId,'km').lang,'km');
});

/* ───────── #9 Deleted records ───────── */
await section('#9 tombstones excluded from fee data / night patrol / counts; fire-history & cctv-log tombstones match front-end keys',async()=>{
 const r=rt();
 clientPush(r,'expense',[{id:'E1',name:'Security Fee Aug',cat:'Security Fee',dept:'Security Fee',date:'2026-08-05',amount:500,updatedAt:'2026-09-01T00:00:00Z'}]);
 assert.equal(r.c.hasSecurityFeeData('2026-08'),true);
 const man=r.get({action:'smartManifest',tool:'expense'}).data;clientPush(r,'expense',[{_deleted:true,_recordKey:'expense|id|E1',id:'E1',cat:'Security Fee',dept:'Security Fee',date:'2026-08-05',updatedAt:'2026-09-02T00:00:00Z'}],null,man.hashes);
 assert.equal(r.c.hasSecurityFeeData('2026-08'),false,'deleted fee is not fee data');assert.equal(r.c.cloudPayloadHasMonth('expense','2026-08'),false);
 // night patrol + dashboard counts
 const p=rt('2026-09-14T01:00:00Z');clientPush(p,'patrol',[{_k:'manual',id:'M1',date:'2026-09-12',time:'23:00',guard:'A',location:'Gate'},{_k:'manual',id:'M2',date:'2026-09-12',time:'23:30',guard:'B',location:'Gate'},{_deleted:true,_recordKey:'patrol|id|M3',_k:'manual',id:'M3',date:'2026-09-12',time:'23:45',guard:'C',location:'Gate'}]);
 assert.deepEqual(clone(p.c.nightPatrolShortage().map(x=>x.count)),[2]);assert.equal(p.c.getSnap('patrol').recordCount,2,'dashboard count excludes deleted');
 p.c.sendDashboard(CHAT,'en');assert(p.messages.at(-1).text.includes(': 2'),p.messages.at(-1).text);
 // extra arrays: server merge keys == front-end keys, so tombstones delete the live entry
 const f=rt();f.post({action:'push',tool:'fire',records:[{code:'FE01',type:'ext',loc:'Gate'}],extra:{history:[{id:'H1',date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'}]}});
 f.post({action:'push',tool:'fire',records:[],extra:{history:[{_deleted:true,_recordKey:'fire-history|id|H1',id:'H1',date:'2026-09-01',updatedAt:'2026-09-02T00:00:00Z'}]}});
 const h=JSON.parse(f.disk['fire.json']).extra.history;assert.equal(h.length,1);assert(h[0]._deleted,'fire-history tombstone replaced the live entry');
 f.post({action:'push',tool:'cctv',records:[{code:'CCTV A-01'}],extra:{log:[{date:'2026-09-01',name:'Log',updatedAt:'2026-09-01T00:00:00Z'}]}});
 f.post({action:'push',tool:'cctv',records:[],extra:{log:[{_deleted:true,_recordKey:'cctv-log|date|2026-09-01|Log',date:'2026-09-01',name:'Log',updatedAt:'2026-09-02T00:00:00Z'}]}});
 assert.equal(JSON.parse(f.disk['cctv.json']).extra.log.length,1);
 // record keys identical to shared/sec-core.js recordKey
 const {JSDOM}=require(path.join(ROOT,'node_modules/jsdom'));const dom=new JSDOM('<html><body></body></html>',{url:'https://x.test/',runScripts:'outside-only'});
 vm.runInContext(fs.readFileSync(path.join(ROOT,'shared/sec-core.js'),'utf8'),dom.getInternalVMContext());const SEC=dom.window.SEC;
 const rows=[{id:'A'},{code:'C1'},{_k:'truck',name:'n'},{month:'2026-09',empId:'7'},{date:'2026-09-01',name:'Sok',time:'22:00',guard:'G'},{date:'2026-09-01',time:'22:00',guard:'G',location:'L'},{t:'2026-09-01 22:00:00',c:'CHIP',g:'G'},{_recordKey:'x|y'}];
 for(const tool of ['patrol','expense','fire-history','cctv-log','attendance'])rows.forEach((x,i)=>assert.equal(f.c.cloudRecordKey(tool,x,i),SEC.recordKey(tool,x,i),tool+' '+JSON.stringify(x)));
 dom.window.close();
});

/* ───────── #10 Performance / space / concurrency ───────── */
await section('#10 manifest without content reads, folder cached, cleanup keeps 2 master versions + in-flight uploads, commit merge under lock, tgPace lock-free, 清理舊資料',()=>{
 const r=rt();for(let i=0;i<6;i++)clientPush(r,'container',[{_k:'truck',id:'T'+i,date:'2026-0'+(3+i)+'-10',updatedAt:'2026-09-01T00:00:00Z'}],null,i?r.get({action:'smartManifest',tool:'container'}).data.hashes:null);
 const b0=r.blobReads(),mf=r.get({action:'smartManifest',tool:'container'}).data;assert.equal(Object.keys(mf.hashes).length,6);assert.equal(r.blobReads()-b0,1,'only the manifest is read');
 assert(r.props.SEC_FOLDER_ID,'folder id cached');
 // normal tool: superseded bucket files trashed after 30 min; in-flight staged upload kept
 const n=rt();clientPush(n,'expense',[{id:'A',date:'2026-09-01',v:1}]);const firstFiles=Object.keys(n.disk).filter(x=>/^smart_expense_sec_/.test(x));
 n.advance(31*60000);const staged=clientPush(n,'expense',[{id:'Z',date:'2026-07-01'}],null,null,{stageOnly:true});
 clientPush(n,'expense',[{id:'A',date:'2026-09-01',v:2}],null,n.get({action:'smartManifest',tool:'expense'}).data.hashes);
 assert(firstFiles.every(x=>!n.disk[x]),'superseded file removed');assert(Object.keys(n.disk).some(x=>x.includes(staged.uploadId)),'recent in-flight staged file kept');
 // master tool: keep newest 2 superseded versions
 const m=rt();const ver=[];for(let v=1;v<=4;v++){m.advance(31*60000);clientPush(m,'personnel',[{id:'P1',name:'Guard',v,month:'2026-09'}],null,v>1?m.get({action:'smartManifest',tool:'personnel'}).data.hashes:null);ver.push(Object.keys(m.disk).filter(x=>/^smart_personnel_.*_merged_/.test(x)&&!ver.flat().includes(x)));}
 const liveMan=JSON.parse(m.disk['smart_personnel_manifest.json']);assert.equal(liveMan.history.length,2);
 assert(ver[0].every(x=>!m.disk[x]),'oldest version removed');assert(ver[1].concat(ver[2],ver[3]).every(x=>m.disk[x]),'active + 2 previous versions kept');
 // commit is serialized by the script lock
 const l=rt();const st=clientPush(l,'expense',[{id:'A',date:'2026-09-01'}],null,null,{stageOnly:true});l.setLocked(true);
 assert(!l.post({action:'smartCommit',tool:'expense',uploadId:st.uploadId,hashes:st.hashes,counts:st.counts,recordCount:1,meta:{}}).ok);l.setLocked(false);
 // two devices with the same stale manifest: both records survive (newer updatedAt wins on same key)
 const t=rt();clientPush(t,'expense',[{id:'BASE',date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'},{id:'SAME',date:'2026-09-02',v:'base',updatedAt:'2026-09-01T00:00:00Z'}]);
 const base=t.get({action:'smartManifest',tool:'expense'}).data.hashes;
 clientPush(t,'expense',[{id:'BASE',date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'},{id:'SAME',date:'2026-09-02',v:'A-new',updatedAt:'2026-09-05T00:00:00Z'},{id:'FROM_A',date:'2026-09-03',updatedAt:'2026-09-03T00:00:00Z'},{id:'A_OCT',date:'2026-10-01',updatedAt:'2026-09-03T00:00:00Z'}],null,base);
 clientPush(t,'expense',[{id:'BASE',date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'},{id:'SAME',date:'2026-09-02',v:'B-old',updatedAt:'2026-09-04T00:00:00Z'},{id:'FROM_B',date:'2026-09-04',updatedAt:'2026-09-04T00:00:00Z'}],null,base);
 const got=Object.fromEntries(liveRows(t,'expense').map(x=>[x.id,x]));assert.deepEqual(Object.keys(got).sort(),['A_OCT','BASE','FROM_A','FROM_B','SAME']);assert.equal(got.SAME.v,'A-new');
 // a bucket the client verified and deliberately dropped (older than the upload) is removed; one created concurrently is kept
 t.advance(5*60000);const cur=t.get({action:'smartManifest',tool:'expense'}).data.hashes;const keep=Object.assign({},cur);delete keep['m:2026-10'];
 clientPush(t,'expense',[{id:'BASE',date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'}],null,keep);assert(!t.get({action:'smartManifest',tool:'expense'}).data.hashes['m:2026-10'],'front-end drop honoured');
 // split sub-buckets: server-side merges (QR/legacy push) land in the same sub-bucket the browser uses
 const sp=rt();const rowsS=Array.from({length:6},(_,i)=>({_k:'truck',id:'S'+i,date:'2026-09-0'+(i+1)}));const parts={};rowsS.forEach((x,i)=>{const k='m:2026-09~2.'+(parseInt(sp.c.secPersonnelHash_(sp.c.cloudRecordKey('container',x,i)),16)%2);(parts[k]=parts[k]||[]).push(x);});
 const up='sec_'+sp.c.Date.now().toString(36)+'_ab',hs={},cs={};for(const k of Object.keys(parts)){const pk=sp.c.secSmartBucketPack_(parts[k]);hs[k]=pk.hash;cs[k]=pk.rows.length;sp.post({action:'smartBucket',tool:'container',uploadId:up,bucket:k,records:pk.rows});}
 assert(sp.post({action:'smartCommit',tool:'container',uploadId:up,hashes:hs,counts:cs,recordCount:6,meta:{}}).ok);
 sp.post({action:'push',tool:'container',records:[{_k:'truck',id:'S3',date:'2026-09-04',note:'edited',updatedAt:'2026-09-20T00:00:00Z'}]});
 const spm=sp.get({action:'smartManifest',tool:'container'}).data;assert.deepEqual(clone(Object.keys(spm.hashes).sort()),clone(Object.keys(parts).sort()),'no extra m:2026-09 bucket');assert.equal(liveRows(sp,'container').filter(x=>x.id==='S3').length,1);
 // tgPace_ never touches the script lock (callers already hold it)
 const g=rt();g.setLocked(true);g.c.tgPace_();assert.equal(g.isLocked(),true);assert(!/tgPace_[\s\S]{0,300}getScriptLock/.test(SRC.slice(SRC.indexOf('function tgPace_'),SRC.indexOf('function tgPace_')+900)));
 // monthly property cleanup
 const c=rt('2026-12-15T01:00:00Z');const old='2026-08-01T00:00:00Z',recent='2026-12-01T00:00:00Z';
 Object.assign(c.props,{container_live_msg_a:JSON.stringify({at:old}),container_live_msg_b:JSON.stringify({at:recent}),'idem_x':'EXP-OLD|'+Date.parse(old),'idem_y':'EXP-NEW|'+Date.parse(recent),
  'dispatch_sent_2026-08_fire':'{}','dispatch_sent_2026-11_fire':'{}','monthly_status_2026-08':'{}','monthly_status_2026-11':'{}',tok_closed:'BC#1',tok_open:'BO#1',tok_gone:'BX#1'});
 c.disk['batch_BC.json']=JSON.stringify({batchId:'BC',status:'closed',closedAt:old,items:[]});c.disk['batch_BO.json']=JSON.stringify({batchId:'BO',status:'open',items:[]});
 const res=c.c.清理舊資料();assert.deepEqual([res.container_live_msg,res.idem,res.dispatch_sent,res.monthly_status,res.tok],[1,1,1,1,2]);
 assert(c.props.container_live_msg_b&&c.props.idem_y&&c.props['dispatch_sent_2026-11_fire']&&c.props['monthly_status_2026-11']&&c.props.tok_open);
 c.c.pendingDispatchReminderJob();assert.equal(c.props.cleanup_last_ym,'2026-12','daily trigger runs the monthly cleanup once');
});

/* ───────── #11 Buttons ───────── */
await section('#11 every inline button: callback_data ≤64 bytes and routed to a handler; url buttons point to existing pages',()=>{
 const r=rt();r.props.WEBHOOK_KEY='K';const kbs=[];
 const items=Array.from({length:14},(_,i)=>fee('rec-'+i,i+1));
 const b=r.c.createApprovalBatch({module:'expense',period:'2026-09',batch:'X'.repeat(90),items});assert(b.batchId.length<=40);
 let B=batchOf(r,b.batchId);kbs.push(r.c.renderBatchKeyboard(B));B.stage='approve';for(let p=0;p<3;p++){B.page=p;for(const lang of ['zh','en','km']){B.lang=lang;kbs.push(r.c.renderBatchKeyboard(B));}}
 B.status='closed';kbs.push(r.c.renderBatchKeyboard(B));
 for(const lang of ['zh','en','km']){kbs.push(r.c.summaryKeyboard(lang,''));for(const m of ['patrol','cctv','container','expense','attendance','commute','fire','personnel'])kbs.push(r.c.summaryKeyboard(lang,m));r.c.sendSecMenu(CHAT,lang);}
 r.c.sendBatchResult(batchOf(r,b.batchId));r.cb('bv:'+b.batchId,PHEA,'K');
 r.messages.forEach(m=>{if(m.kb)kbs.push(m.kb);});
 const pages=new Set(fs.readdirSync(ROOT).filter(x=>/\.html$/.test(x)));const datas=new Set();let urls=0;
 for(const kb of kbs)for(const row of kb.inline_keyboard)for(const btn of row){
  if(btn.callback_data!==undefined){assert(Buffer.byteLength(btn.callback_data)<=64,btn.callback_data);datas.add(btn.callback_data);}
  else{assert(btn.url.startsWith(BASE+'/'),btn.url);const file=btn.url.slice(BASE.length+1).split('?')[0];assert(pages.has(file),'missing page '+file);urls++;}
 }
 assert(urls>20);
 const kinds=new Set([...datas].map(d=>d.split(':')[0]));for(const k of ['ap','ba','bc','bp','bl','br','bn','bv','sec_status','sec_dash','sec_anom','sec_night','sec_pend','lang_zh','lang_en','lang_km'])assert(kinds.has(k),'button kind '+k);
 const b2=r.c.createApprovalBatch({module:'expense',period:'2026-09',items:[fee('route-1',1)]}),B2=batchOf(r,b2.batchId);
 const route=[...datas].filter(d=>!/^(ap|ba|bc|bp|bl|br|bn|bv):/.test(d)).concat(['bv:'+b2.batchId,'bp:'+b2.batchId+':0','bl:'+b2.batchId+':en','br:'+b2.batchId,'bn:'+b2.batchId,'ap:'+B2.items[0].token+':A','ba:'+b2.batchId,'bc:'+b2.batchId,'selftest']);
 for(const data of route){const out=JSON.parse(r.c.handleCallback({id:'q',data,message:{chat:{id:CHAT},message_id:5,text:'x'},from:{id:PAUL,first_name:'Paul'}}).text);assert(out.ok&&out.data.handled!==false,data+' → '+JSON.stringify(out));}
});

/* ───────── #12 Deployment check ───────── */
await section('#12 部署後檢查 logs masked token, webhook+key, group, triggers, property size, Drive, test message; 更新部署連線 ends with the same checks',()=>{
 const r=rt();r.props.BOT_TOKEN='123456:ABCDEFGHIJKLMNOP';r.c.setupWebhook(false);const m0=r.messages.length;
 const out=r.c.部署後檢查();
 for(const s of ['✅ Bot Token：1234…MNOP','✅ Webhook 指向現行 /exec 且含金鑰','✅ Bot 在群組：AC SEC Group','✅ 排程：pendingDispatchReminderJob','✅ 排程：monthlySummaryJob','指令碼屬性','✅ Drive 資料夾：AC_SEC_Data','✅ 測試訊息已送到群組'])assert(out.includes(s),s+'\n'+out);
 assert(!out.includes('ABCDEFGHIJKLMNOP'));assert(!out.includes(r.props.WEBHOOK_KEY));assert.equal(r.messages.length,m0+1);
 const u=rt(undefined,{triggers:[]});u.props.BOT_TOKEN='1:T';const o2=u.c.更新部署連線();assert(o2.includes('═══ 部署後檢查'),o2);assert(o2.includes('✅ Webhook 指向現行 /exec 且含金鑰'));
 assert(!/測試訊息已送到群組/.test(o2.split('═══ 部署後檢查')[1]),'no duplicate test message (the /sec menu already tested sending)');
});

/* ───────── Real browser client ↔ backend (two devices) ───────── */
await section('real sec-smart-sync clients: concurrent device commits merge on the server, no re-upload churn, clear-all + restore round trip',async()=>{
 const {JSDOM}=require(path.join(ROOT,'node_modules/jsdom'));const r=rt();let gate=null;
 function device(name){const dom=new JSDOM('<html><body><span class="c-dot"></span></body></html>',{url:'https://'+name+'.test/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync(path.join(ROOT,'shared/sec-core.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(ROOT,'shared/sec-smart-sync.js'),'utf8'),ctx);
  w.SEC.setCfg({gasUrl:'https://gas.test/exec'});w.SEC._autoSyncSilent=true;w.SEC.toast=()=>{};const calls=[];
  w.fetch=async(url,o={})=>{let out;if(o.method==='POST'){const body=JSON.parse(o.body);calls.push(body.action);if(body.action==='smartCommit'&&gate&&gate.dev===name)await gate.wait;out=r.c.doPost({postData:{contents:o.body}}).text;}
   else{const p=Object.fromEntries(new URL(url).searchParams);calls.push(p.action);out=r.c.doGet({parameter:p}).text;}return {ok:true,status:200,text:async()=>out};};
  return {w,dom,calls,SEC:w.SEC};}
 const A=device('a'),B=device('b'),C=device('c');
 const base=[{id:'BASE',name:'Base',cat:'Other',amount:1,date:'2026-09-01',updatedAt:'2026-09-01T00:00:00Z'}];
 assert(await A.SEC.cloudPush('expense',clone(base),{},{}));const bp=await B.SEC.cloudPull('expense',{localRecords:[]});assert.equal(bp.length,1);
 const recsB=clone(base).concat([{id:'FROM_B',name:'B',cat:'Other',amount:2,date:'2026-09-05',updatedAt:'2026-09-05T00:00:00Z'}]);
 let open;gate={dev:'b',wait:new Promise(res=>{open=res;})};const pB=B.SEC.cloudPush('expense',recsB,{},{});await new Promise(res=>setTimeout(res,20));
 assert(await A.SEC.cloudPush('expense',clone(base).concat([{id:'FROM_A',name:'A',cat:'Other',amount:3,date:'2026-09-04',updatedAt:'2026-09-04T00:00:00Z'}]),{},{}));
 open();assert(await pB);gate=null;
 const cp=await C.SEC.cloudPull('expense',{localRecords:[]});assert.deepEqual(clone(cp.map(x=>x.id).sort()),['BASE','FROM_A','FROM_B'],'both concurrent edits survive');
 const bpull=await B.SEC.cloudPull('expense',{localRecords:recsB});const merged=B.SEC.mergeRecords('expense',recsB,bpull).records;
 const n0=B.calls.filter(x=>x==='smartBucket').length;assert(await B.SEC.cloudPush('expense',merged,{},{}));assert.equal(B.calls.filter(x=>x==='smartBucket').length,n0,'no churn after merge');
 // clear-all on device C (tombstones) → backup + notice → restore → C sees rows again
 const m0=r.messages.length;C.SEC.markDeletedMany('expense',cp);assert(await C.SEC.cloudPush('expense',[],{},{}));
 assert.equal(liveRows(r,'expense').length,0);assert(r.messages.slice(m0).some(m=>/3 → 0/.test(m.text)));
 assert(r.c.還原雲端備份('expense').startsWith('✅'));const back=await C.SEC.cloudPull('expense',{localRecords:[]});
 assert.equal(C.SEC.mergeRecords('expense',[],back).records.length,3,'restored rows beat the device tombstones');
 [A,B,C].forEach(d=>d.dom.window.close());
});

if(failures){console.log('\n'+failures+' section(s) FAILED');process.exit(1);}
console.log('\nALL fix-backend sections passed');
})();
