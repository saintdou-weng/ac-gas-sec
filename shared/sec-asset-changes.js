/* Equipment master changes are independent of recurring inspection reports.
   照片只存在主檔紀錄本身：_assetState 與異動事件的 before/after 只存照片張數與簡短雜湊
   （photoN／photoSig），不再複製 base64。事件本身只保留「這次新拍」的證據照片供 Telegram 使用。 */
(function(g){
'use strict';var S=g.SEC;
var FIELDS={fire:['code','type','factory','zone','loc','expiryDate','replacementDate','serviceDate','cycle','status','remark','x','y'],cctv:['code','name','factory','zone','type','nvr','ch','ip','status','remark']};
function clone(x){return JSON.parse(JSON.stringify(x));}
function txt(x){return String(x==null?'':x).trim();}
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function photos(r){return (Array.isArray(r&&r.photos)?r.photos:r&&r.photo?[r.photo]:[]).filter(Boolean);}
function sig(list){return S.photoSig?S.photoSig(list):list.length+':'+hash(list.join('\u0001'));}
/* 狀態快照：照片以「張數＋雜湊」表示；張數為 0 時保留 photos:[]，讓前後端合併都能保留「刻意刪除照片」。 */
function fields(tool,r){if(!r)return null;var o={};FIELDS[tool].forEach(function(k){o[k]=txt(r[k]);});var ph=photos(r);o.photoN=ph.length;o.photoSig=sig(ph);if(!ph.length)o.photos=[];return o;}
/* 舊資料的 before/after 可能帶整份照片；改成簡短指紋（就地瘦身，回傳是否有變更）。 */
function slimSnapshot(v){if(!v||typeof v!=='object'||!Array.isArray(v.photos)||!v.photos.length)return false;var ph=v.photos.filter(Boolean);v.photoN=ph.length;v.photoSig=sig(ph);delete v.photos;return true;}
function slimEvents(events){var n=0;(Array.isArray(events)?events:[]).forEach(function(e){if(!e)return;if(slimSnapshot(e.before))n++;if(slimSnapshot(e.after))n++;});return n;}
function key(r){return txt(r&&r.id||r&&r._recordKey||r&&r.code);}
function bad(tool,s){return tool==='fire'?s==='fault':/^(off|blur|fault)$/.test(s);}
function capture(tool,events,before,after,opt){
  opt=opt||{};var date=opt.date||S.ymd(),old={},next={},made=[];
  slimEvents(events);
  before.forEach(function(r){old[key(r)]=r;});after.forEach(function(r){next[key(r)]=r;});
  Object.keys(Object.assign({},old,next)).forEach(function(id){
    var a=old[id],b=next[id],av=fields(tool,a),bv=fields(tool,b),force=opt.kind==='replace'&&(!opt.id||id===opt.id);
    if(JSON.stringify(av)===JSON.stringify(bv)&&!force)return;
    /* 狀態時間戳必須嚴格晚於上一版，同一毫秒內連續修改時合併結果才不會因順序而不同。 */
    if(b){var ts=Date.now(),prevTs=Date.parse(S.unwrapObject((a&&a._assetState)||b._assetState||{}).updatedAt||'')||0;if(ts<=prevTs)ts=prevTs+1;b._assetState=S.replaceObject(bv,new Date(ts).toISOString());}
    var kind=!a?'add':!b?'remove':force?'replace':bad(tool,b.status)&&!bad(tool,a.status)?'fault':bad(tool,a.status)&&!bad(tool,b.status)?'recovered':'update';
    var signature=JSON.stringify([tool,id,date,kind,bv||av,opt.reason||'']);
    /* 一般更新只附「這次新增」的照片；新增／更換／故障附目前照片作為證據。 */
    var oldPh=photos(a),evPh=kind==='remove'||kind==='recovered'?[]:kind==='update'?photos(b).filter(function(p){return oldPh.indexOf(p)<0;}):photos(b);
    var event={id:'AC-'+tool+'-'+hash(signature),assetId:id,date:date,kind:kind,before:av,after:bv,photos:evPh,by:opt.by||S.getCfg().operator||'',reason:opt.reason||'',source:opt.source||'master',createdAt:new Date().toISOString()};
    if(!events.some(function(e){return e.id===event.id;})){events.push(event);made.push(event);}
  });return made;
}
function refreshStates(tool,rows,events){rows.forEach(function(r){if(r._assetState){var f=fields(tool,r),old=S.unwrapObject(r._assetState).data;if(JSON.stringify(f)!==JSON.stringify(old))r._assetState=S.replaceObject(f,new Date().toISOString());}});if(events)slimEvents(events);}
function inspectionEvents(tool,history,master,changes){
  var catalog={},previous={},out=[];
  master.forEach(function(r){catalog[key(r)]=r;});(changes||[]).forEach(function(e){if(!catalog[e.assetId])catalog[e.assetId]=e.after||e.before||{};});
  (history||[]).filter(function(h){return h&&h.date&&!h._deleted;}).slice().sort(function(a,b){return String(a.date).localeCompare(String(b.date))||String(a.updatedAt||'').localeCompare(String(b.updatedAt||''));}).forEach(function(h){
    var items=tool==='fire'?(h.items||[]):Object.keys(h.st||{}).map(function(id){return Object.assign({},(h.cameras||[]).filter(function(c){return key(c)===id;})[0]||catalog[id]||{code:id},{id:id,result:h.st[id],note:bad(tool,h.st[id])?h.note||'':'',photos:bad(tool,h.st[id])?photos(h):[]});});
    items.forEach(function(r){
      var id=key(r),status=r.result||r.status||'ok',isBad=bad(tool,status),prev=previous[id],note=isBad?txt(r.note||r.remark):'',ph=isBad?photos(r).concat(tool==='cctv'?photos(h):[]).filter(function(x,i,a){return a.indexOf(x)===i;}):[];
      var fingerprint=JSON.stringify([status,note,ph]),changed=prev?prev.fingerprint!==fingerprint:isBad;
      if(changed&&(isBad||prev&&prev.bad)){
        var row=Object.assign({},catalog[id]||{},r),kind=isBad?'fault':'recovered';
        var ev={id:'AI-'+tool+'-'+hash(JSON.stringify([id,h.date,kind,fingerprint])),assetId:id,date:h.date,kind:kind,before:prev&&prev.row||null,after:fields(tool,row),photos:ph,by:h.by||'',reason:note,source:'inspection'};
        // The outcome belongs to the inspection result, not the current master status.
        ev.after.status=status;out.push(ev);
      }
      previous[id]={bad:isBad,fingerprint:fingerprint,row:fields(tool,Object.assign({},r,{status:status}))};
    });
  });return out;
}
function period(st){var d=S.parseD(st.period)||new Date();if(st.ptype==='month')d=new Date(+st.period.slice(0,4),+st.period.slice(5,7)-1,1);if(st.ptype==='year')d=new Date(+st.period,0,1);return new S.Period(st.ptype,d);}
function selected(events,st,match){var p=period(st),seen={};return events.filter(function(e){var yes=e&&!e._deleted&&e.date&&p.has(e.date)&&(!match||match(st,e.after||e.before||{}))&&!seen[e.id];seen[e.id]=true;return yes;}).sort(function(a,b){return String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id));});}
/* 訊息語言（Telegram 內容）：zh / en / km；both 由 tgOpen 分別產生 zh 與 en 後合併。 */
function tl(lang,zh,en,km){return lang==='en'?en:lang==='km'?(km||en):zh;}
var LABELS={add:['新增','Added','បន្ថែម'],remove:['移除','Removed','ដកចេញ'],replace:['更換新品','Replaced','ប្តូរថ្មី'],fault:['異常／更新證據','Fault / evidence','មានបញ្ហា / ភស្តុតាង'],recovered:['恢復正常','Recovered','ដំណើរការធម្មតាវិញ'],update:['資料更新','Updated','បានធ្វើបច្ចុប្បន្នភាព']};
function label(kind,lang){var a=LABELS[kind]||LABELS.update;return tl(lang,a[0],a[1],a[2]);}
function titleOf(tool,lang){return tool==='fire'?tl(lang,'🧯 消防設備異動','🧯 Fire equipment changes','🧯 ការផ្លាស់ប្តូរឧបករណ៍ពន្លត់អគ្គិភ័យ'):tl(lang,'📷 CCTV 設備異動','📷 Camera changes','📷 ការផ្លាស់ប្តូរកាមេរ៉ា');}
function pages(tool,events,st,match){
  var lang=st.lang==='both'?'zh':st.lang,rows=selected(events,st,match),title=titleOf(tool,lang)+' · '+S.esc(period(st).label()),count={},seen={},defs=[],lines=[],ph=[];
  rows.forEach(function(r){count[r.kind]=(count[r.kind]||0)+1;});
  var head='<b>'+title+'</b>\n'+(rows.length?Object.keys(count).map(function(k){return label(k,lang)+' '+count[k];}).join(' · '):tl(lang,'✅ 本期無異動，沿用既有設備資料。','✅ No changes; existing equipment remains in use.','✅ គ្មានការផ្លាស់ប្តូរ។ ឧបករណ៍ដដែលនៅតែប្រើប្រាស់។'));
  function flush(){if(lines.length){defs.push({text:(defs.length?'<b>'+title+'</b>':head)+'\n'+lines.join('\n'),photos:ph});lines=[];ph=[];}}
  rows.forEach(function(e){var r=e.after||e.before||{},a=e.before||{},b=e.after||{},diff=[];
    FIELDS[tool].forEach(function(k){if(['code','loc','name','x','y','remark'].indexOf(k)>=0)return;if(a[k]!==b[k]&&e.before&&e.after)diff.push(k+' '+(a[k]||'—')+' → '+(b[k]||'—'));});
    var line=(e.kind==='fault'?'⚠️ ':e.kind==='recovered'?'✅ ':'· ')+S.esc(e.date)+' · '+label(e.kind,lang)+' · <b>'+S.esc((r.code||'—')+' · '+(r.loc||r.name||r.zone||'—'))+'</b>'+(diff.length?' · '+S.esc(diff.join(' · ')):'')+(e.reason?' · '+S.esc(e.reason):'')+(e.by?' · '+S.esc(e.by):'');
    var photosToSend=(e.photos||[]).filter(function(p){if(seen[p])return false;seen[p]=true;return true;});
    if(lines.length&&(lines.length>=8||lines.join('\n').length+line.length>2500||ph.length+photosToSend.length>4))flush();
    lines.push(line);ph=ph.concat(photosToSend.slice(0,4));if(photosToSend.length>4)flush();
    for(var i=4;i<photosToSend.length;i+=4)defs.push({text:'<b>'+title+'</b>\n'+line,photos:photosToSend.slice(i,i+4)});
  });flush();if(!defs.length)defs.push({text:head,photos:[]});return defs;
}
function resetEditor(id){var d=document.getElementById('e_assetDate'),k=document.getElementById('e_assetKind');if(d)d.value=S.ymd();if(k){k.value='update';k.disabled=!id;}}
function editorOptions(id){var d=document.getElementById('e_assetDate');if(!d||!/^\d{4}-\d{2}-\d{2}$/.test(d.value))throw Error(S.L('請填寫異動日期','Enter the change date','សូមបញ្ចូលកាលបរិច្ឆេទផ្លាស់ប្តូរ'));return {id:id,date:d.value,kind:document.getElementById('e_assetKind').value};}
function open(opt){return S.tgOpen({module:opt.tool,hideDetails:true,reportKind:'masterChanges',modalTitle:opt.tool==='fire'?{zh:'消防設備異動摘要',en:'Fire equipment changes',km:'សេចក្តីសង្ខេបការផ្លាស់ប្តូរឧបករណ៍ពន្លត់អគ្គិភ័យ'}:{zh:'CCTV 設備異動摘要',en:'Camera changes',km:'សេចក្តីសង្ខេបការផ្លាស់ប្តូរកាមេរ៉ា'},defaultType:opt.period.mode,defaultPeriod:opt.period.key(),defaultLang:'both',currentPeriod:function(type){return new S.Period(type,opt.period.at).key();},scopeOptions:opt.scopeOptions,defaultScope:'all',periods:function(type){var seen={};opt.events().forEach(function(e){if(e&&e.date)seen[new S.Period(type,S.parseD(e.date)).key()]=1;});return Object.keys(seen);},summaryPages:function(st){return pages(opt.tool,opt.events(),st,opt.match).map(function(p){return p.text;});},summaryPhotos:function(st,i){var p=pages(opt.tool,opt.events(),st,opt.match)[i];return p?p.photos:[];},beforeSummarySend:async function(){await opt.save();if(!await opt.upload())throw Error(S.L('雲端更新失敗，請稍後再試','Cloud save failed. Please try again.','រក្សាទុកក្នុងពពកបរាជ័យ។ សូមព្យាយាមម្តងទៀត។'));}});}
S.AssetChanges={refreshStates:refreshStates,clone:clone,capture:capture,inspectionEvents:inspectionEvents,selected:selected,pages:pages,resetEditor:resetEditor,editorOptions:editorOptions,open:open,slimEvents:slimEvents,fields:fields,label:label};
})(window);
