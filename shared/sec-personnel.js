/* SEC personnel: effective-month versions shared by Personnel and Attendance.
   Each person/month snapshot is atomic, so blank fields and removal survive
   merges while versions belonging to other months remain intact. */
(function(g){
'use strict';
var S=g.SEC, LS='ac_sec_personnel_db', LC='ac_sec_personnel_chg', BUSY=false, WRITE_QUEUE=Promise.resolve();
var FIELDS=['empId','name','position','shift','post','joinDate','resignDate','phone','company','status','remark','photo'];
function text(v){return String(v==null?'':v).trim();}
function tr(zh,en,km){return S.lang()==='en'?en:S.lang()==='km'?km:zh;}
function month(v){var m=text(v).match(/^(\d{4})-(0[1-9]|1[0-2])/);return m?m[1]+'-'+m[2]:'';}
function currentMonth(){return S.ymd().slice(0,7);}
function validName(v){var n=text(v);return !!n&&!/^(?:(?:red|green|yellow|blue)\s*[:=]|total\b|subtotal\b|grand total\b|合計|小計|備註|說明|day\s*off\b|take\s+leave\b|legend\b)/i.test(n);}
function eid(v){return text(v).toUpperCase().replace(/^A?(\d+)$/,function(_,n){return String(Number(n));});}
function same(a,b){if(a.empId&&b.empId)return eid(a.empId)===eid(b.empId);return S.norm(a.name)===S.norm(b.name);}
function clone(v){return JSON.parse(JSON.stringify(v));}
function fields(r){var o={};FIELDS.forEach(function(k){o[k]=text(r&&r[k]);});o.status=o.status||'active';return o;}
function legacy(r,m){
  if(month(r.joinDate)&&m<month(r.joinDate))return null;
  var o=Object.assign({},r);delete o._rosterHistory;
  if((r.status==='resigned'||r.status==='removed')&&month(r.resignDate)&&m<month(r.resignDate)){o.status='active';o.resignDate='';}
  return o;
}
function snapshot(r,m){
  m=month(m);if(!r||!m)return null;
  var h=r._rosterHistory||{},keys=Object.keys(h).filter(function(k){return k<=m;}).sort();
  var o=keys.length?S.unwrapObject(h[keys[keys.length-1]]).data:legacy(r,m);
  if(!o||o.exists===false)return null;
  return Object.assign({},clone(o),{id:r.id,_attKey:r._attKey||o._attKey||text(r.empId||r.name||r.id)});
}
function versions(r){
  if(r._rosterHistory)return;
  var base=fields(r),join=month(r.joinDate),leave=month(r.resignDate),h={},stamp='1970-01-01T00:00:00.000Z';
  if(leave&&(base.status==='resigned'||base.status==='removed')){base.status='active';base.resignDate='';}
  h['0000-01']=S.replaceObject(join?{exists:false}:Object.assign({exists:true},base),stamp);
  if(join)h[join]=S.replaceObject(Object.assign({exists:true},base),stamp);
  if(leave&&(r.status==='resigned'||r.status==='removed'))h[leave]=S.replaceObject(Object.assign({exists:true},fields(r)),stamp);
  r._attKey=r._attKey||text(r.empId||r.name||r.id);r._rosterHistory=h;
}
function list(db,m,includeInactive){return (db||[]).map(function(r){return snapshot(r,m);}).filter(function(r){return r&&validName(r.name)&&(includeInactive||r.status==='active');});}
function mirror(r){
  var m=currentMonth(),v=snapshot(r,m);
  if(!v){var h=r._rosterHistory||{},ks=Object.keys(h).sort();v=ks.length?S.unwrapObject(h[ks[ks.length-1]]).data:{};v=Object.assign({},v,{status:'planned'});}
  FIELDS.forEach(function(k){r[k]=text(v[k]);});
}
function signature(r){return JSON.stringify(['id','personId','kind','date','effectiveMonth','empId','name','position','fromShift','toShift','fromPost','toPost','reason','by','before','after'].map(function(k){return r&&r[k]||'';}));}
function unsent(r){var d=S.unwrapObject(r._personnelDelivery).data;return d.signature?d.signature!==signature(r):!r.notified;}
function apply(db,changes,input,opt){
  opt=opt||{};var m=month(opt.month),date=opt.date||m+'-01';
  if(!m||month(date)!==m)throw Error(tr('生效日期必須在生效月份內','Effective date must be in the selected month','ថ្ងៃចូលជាធរមានត្រូវនៅក្នុងខែដែលបានជ្រើស'));
  if(!validName(input.name))throw Error(tr('請填寫真實姓名；說明列不能當成人員','Enter a real name; legend rows are not people','សូមបញ្ចូលឈ្មោះពិត'));
  var row=opt.id?db.filter(function(r){return r.id===opt.id;})[0]:db.filter(function(r){return same(r,input);})[0];
  if(opt.id&&!row)throw Error('Personnel record no longer exists / 找不到人員');
  var oldChange=opt.changeId?changes.filter(function(r){return r.id===opt.changeId;})[0]:null;
  if(oldChange&&(oldChange.effectiveMonth||month(oldChange.date))!==m)throw Error('Edit the original effective month / 請在原生效月份修正異動');
  var before=row?snapshot(row,m):null,stamp=new Date().toISOString(),isNew=!row;
  var after=Object.assign({},before||{},input);after=fields(after);after.status=after.status||'active';
  if(['active','resigned','removed'].indexOf(after.status)<0)throw Error('Invalid personnel status');
  if(db.some(function(r){return (!row||r.id!==row.id)&&Object.keys(r._rosterHistory||{}).concat([m]).some(function(k){var v=snapshot(r,k==='0000-01'?m:k);return v&&same(v,after);});}))throw Error(tr('工號／姓名已存在，請編輯原人員，不要重複新增','ID/name already exists; edit the existing person','អត្តលេខឬឈ្មោះមានរួចហើយ'));
  if(after.status!=='active')after.resignDate=date;
  else if(before&&before.status!=='active')after.resignDate='';
  var sameFields=before&&JSON.stringify(fields(before))===JSON.stringify(after);
  var amend=oldChange&&['kind','date','reason','by'].some(function(k){return opt[k]!==undefined&&text(opt[k])!==text(oldChange[k]);});
  if(sameFields&&!amend)return {row:row,changed:false,change:null};
  if(!row){row={id:'S'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),createdAt:stamp,_attKey:text(opt.attKey||after.empId||after.name),_rosterHistory:{'0000-01':S.replaceObject({exists:false},'1970-01-01T00:00:00.000Z')}};db.push(row);}
  versions(row);row._rosterHistory[m]=S.replaceObject(Object.assign({exists:true,effectiveMonth:m},after),stamp);row.updatedAt=stamp;mirror(row);S.clearDeleted('personnel',row);
  var kind=opt.kind||(!before||before.status!=='active'&&after.status==='active'?'join':after.status==='resigned'?'resign':after.status==='removed'?'remove':'update');
  var rec={id:oldChange?oldChange.id:'PC'+Date.now().toString(36)+Math.random().toString(36).slice(2,7),personId:row.id,kind:kind,date:date,effectiveMonth:m,empId:after.empId,name:after.name,position:after.position,fromShift:before&&before.shift||'',toShift:after.shift,fromPost:before&&before.post||'',toPost:after.post,reason:opt.reason||after.remark||'',by:opt.by||S.getCfg().operator||'',before:oldChange?oldChange.before:before?fields(before):null,after:after,notified:false,createdAt:oldChange?oldChange.createdAt:stamp,updatedAt:stamp};
  if(oldChange)Object.assign(oldChange,rec);else changes.unshift(rec);
  return {row:row,change:oldChange||rec,changed:true,isNew:isNew};
}
async function read(){return {db:await S.dbGet(LS,[]),changes:await S.dbGet(LC,[])};}
function persist(db,changes){
  db=clone(db);changes=clone(changes);
  var run=function(){return g.navigator.locks?g.navigator.locks.request('sec-personnel-write',function(){return persistNow(db,changes);}):persistNow(db,changes);};
  var result=WRITE_QUEUE.then(run,run);WRITE_QUEUE=result.catch(function(){});return result;
}
async function persistNow(db,changes){
  var current=await read();
  var merged=S.mergeRecords('personnel',current.db,db).records;
  var logs=S.mergeRecords('personnel',current.changes,changes).records;
  merged.forEach(function(r){if(r._rosterHistory)mirror(r);});
  await Promise.all([S.dbPut(LS,merged),S.dbPut(LC,logs)]);
  g.dispatchEvent(new CustomEvent('sec-personnel-updated'));
  return {db:merged,changes:logs};
}
async function extra(){var roster=await S.dbGet('ac_sec_roster_schedule',{}),rev=await S.dbGet('ac_sec_roster_schedule_rev_v1','');return {roster:S.replaceObject(roster,rev||'1970-01-01T00:00:00.000Z')};}
function cloudRecords(db,changes){return db.map(function(r){return Object.assign({_k:'staff'},r);}).concat(changes.map(function(r){return Object.assign({_k:'chg'},r);}));}
async function upload(){var data=await read();return S.cloudPush('personnel',cloudRecords(data.db,data.changes),{staff:list(data.db,currentMonth()).length,changes:data.changes.length},await extra());}
async function pull(opt){
  var data=await read(),ex=await extra(),rows=await S.cloudPull('personnel',{force:!(opt&&opt.auto),localRecords:cloudRecords(data.db,data.changes),localExtra:ex});
  if(!rows)return false;if(rows._cloudMeta&&rows._cloudMeta.unchanged)return true;
  await persist(S.mergeRecords('personnel',data.db,rows.filter(function(r){return r._k!=='chg';})).records,S.mergeRecords('personnel',data.changes,rows.filter(function(r){return r._k==='chg';})).records);
  var remote=rows._cloudExtra||{},roster=S.unwrapObject(S.mergeObject(ex,remote,'personnel').roster);
  await Promise.all([S.dbPut('ac_sec_roster_schedule',roster.data),S.dbPut('ac_sec_roster_schedule_rev_v1',roster.updatedAt)]);return true;
}
async function markSent(selected){
  var data=await read(),at=new Date().toISOString();
  data.changes.forEach(function(r){var match=selected.filter(function(x){return x.id===r.id&&x.signature===signature(r);})[0];if(match){r.notified=true;r._personnelDelivery=S.replaceObject({signature:match.signature,sentAt:at},at);}});
  var saved=await persist(data.db,data.changes);
  if(selected.length)S.scheduleAutoCloudSync('personnel','telegram-summary','');
  return saved;
}
async function notify(r){
  if(!unsent(r))return {sent:true,skippedDuplicate:true};
  var body=Object.assign({},r,{action:'personnelChange',lang:S.lang(),changeId:r.id});
  var out=await S.gasPost(body);if(!out||out.sent!==true)throw Error('Telegram 未送達，異動仍保留待發 / Not delivered; change remains pending');
  await markSent([{id:r.id,signature:signature(r)}]);return out;
}
function openEditor(opt){
  opt=opt||{};var row=opt.id?(opt.db||[]).filter(function(r){return r.id===opt.id;})[0]:null,m=month(opt.month)||currentMonth();
  var r=row?(snapshot(row,m)||fields(row)):Object.assign({status:'active',joinDate:m===currentMonth()?S.ymd():m+'-01'},opt.seed||{}),photo=r.photo||'';
  if(opt.remove)r=Object.assign({},r,{status:'resigned'});
  var mask=document.createElement('div');mask.className='mask on';
  function field(k,label,type,value){return '<div class="f"><label>'+label+'</label><input data-person-field="'+k+'" type="'+(type||'text')+'" value="'+S.esc(value==null?r[k]||'':value)+'"></div>';}
  mask.innerHTML='<div class="modal" style="max-width:640px"><div class="mh"><b>👮 '+tr(row?'編輯人員':'新增人員',row?'Edit person':'Add person',row?'កែបុគ្គលិក':'បន្ថែមបុគ្គលិក')+'</b><button class="x" data-close>×</button></div><div class="mb"><div class="grid g2">'+
    field('effectiveMonth',tr('生效月份','Effective month','ខែចូលជាធរមាន'),'month',m)+field('date',tr('異動日期','Change date','ថ្ងៃផ្លាស់ប្តូរ'),'date',m===currentMonth()?S.ymd():m+'-01')+
    field('empId',tr('工號','Employee ID','អត្តលេខ'))+field('name',tr('姓名','Name','ឈ្មោះ'))+field('position',tr('職稱','Position','តំណែង'))+
    '<div class="f"><label>'+tr('班別','Shift','វេន')+'</label><select data-person-field="shift"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></div>'+field('post',tr('崗位','Post','ប៉ុស្តិ៍'))+field('company',tr('公司','Company','ក្រុមហ៊ុន'))+
    field('joinDate',tr('到職日','Join date','ថ្ងៃចូល'),'date')+field('phone',tr('電話','Phone','ទូរស័ព្ទ'))+
    '<div class="f"><label>'+tr('狀態','Status','ស្ថានភាព')+'</label><select data-person-field="status"><option value="active">'+tr('在職','Active','កំពុងធ្វើការ')+'</option><option value="resigned">'+tr('離職','Resigned','ឈប់ពីការងារ')+'</option><option value="removed">'+tr('移出名冊（誤植／不適用）','Remove from roster (incorrect/inapplicable)','ដកចេញពីបញ្ជី')+'</option></select></div>'+field('by',tr('經辦人','Handled by','អ្នកទទួលខុសត្រូវ'),'text',S.getCfg().operator||'')+
    field('remark',tr('備註／異動原因','Remark / change reason','មូលហេតុ'))+'</div><div class="row" style="margin-top:12px"><span data-photo></span><button class="btn sm gh" data-pick>📷 '+tr('拍照／照片','Camera / photo','កាមេរ៉ា / រូបថត')+'</button><button class="btn sm gh" data-clear>'+tr('移除照片','Remove photo','លុបរូបថត')+'</button></div><p class="hint">'+tr('從生效月份開始延用，直到下一次異動；之前月份不變。離職者本月已登記的出勤與工時保留。','Applies from the effective month until the next change. Earlier months and recorded attendance remain intact.','មានប្រសិទ្ធភាពចាប់ពីខែដែលបានជ្រើស។ ទិន្នន័យខែមុននៅដដែល។')+'</p><div data-error style="color:#b91c1c"></div></div><div class="mf"><button class="btn gh" data-close>'+tr('取消','Cancel','បោះបង់')+'</button><button class="btn gh" data-save>'+tr('儲存並更新雲端','Save & sync','រក្សាទុក និងធ្វើសមកាលកម្ម')+'</button><button class="btn" data-send>💾✈️ '+tr('儲存並發送異動','Save & send change','រក្សាទុក និងផ្ញើការផ្លាស់ប្តូរ')+'</button></div></div>';
  document.body.appendChild(mask);var q=function(sel){return mask.querySelector(sel);};q('[data-person-field="shift"]').value=r.shift||'';q('[data-person-field="status"]').value=r.status==='removed'?'removed':r.status==='resigned'?'resigned':'active';
  function preview(){q('[data-photo]').innerHTML=photo?'<img src="'+S.esc(photo)+'" style="width:54px;height:60px;object-fit:cover;border-radius:6px">':'';}preview();
  q('[data-pick]').onclick=function(){S.pickPhoto(function(p){photo=p;preview();},640);};q('[data-clear]').onclick=function(){photo='';preview();};
  q('[data-person-field="effectiveMonth"]').onchange=function(){q('[data-person-field="date"]').value=this.value===currentMonth()?S.ymd():this.value+'-01';};
  mask.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){if(!BUSY)mask.remove();};});
  async function commit(send){
    if(BUSY)return;BUSY=true;mask.querySelectorAll('button').forEach(function(b){b.disabled=true;});q('[data-error]').textContent='';
    try{
      var input={},values={};mask.querySelectorAll('[data-person-field]').forEach(function(el){values[el.dataset.personField]=el.value.trim();});FIELDS.forEach(function(k){if(k in values)input[k]=values[k];});input.photo=photo;
      var result=await opt.onSave(input,{id:opt.id,attKey:opt.attKey,month:values.effectiveMonth,date:values.date,reason:values.remark,by:values.by,send:send});
      if(result!==false)mask.remove();
    }catch(e){q('[data-error]').textContent=e.message;}
    finally{BUSY=false;mask.querySelectorAll('button').forEach(function(b){b.disabled=false;});}
  }
  q('[data-save]').onclick=function(){return commit(false);};q('[data-send]').onclick=function(){return commit(true);};return mask;
}
S.Personnel={fields:fields,month:month,currentMonth:currentMonth,validName:validName,same:same,snapshot:snapshot,list:list,apply:apply,read:read,persist:persist,upload:upload,pull:pull,notify:notify,unsent:unsent,signature:signature,markSent:markSent,openEditor:openEditor,mirror:mirror,cloudRecords:cloudRecords,tr:tr};
})(window);
