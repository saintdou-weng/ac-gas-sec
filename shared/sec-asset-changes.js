/* Equipment master changes are independent of recurring inspection reports. */
(function(g){
'use strict';var S=g.SEC;
var FIELDS={fire:['code','type','factory','zone','loc','expiryDate','replacementDate','serviceDate','cycle','status','remark','x','y'],cctv:['code','name','factory','zone','type','nvr','ch','ip','status','remark']};
function clone(x){return JSON.parse(JSON.stringify(x));}
function txt(x){return String(x==null?'':x).trim();}
function hash(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function photos(r){return (Array.isArray(r&&r.photos)?r.photos:r&&r.photo?[r.photo]:[]).filter(Boolean);}
function fields(tool,r){if(!r)return null;var o={};FIELDS[tool].forEach(function(k){o[k]=txt(r[k]);});o.photos=photos(r);return o;}
function key(r){return txt(r&&r.id||r&&r._recordKey||r&&r.code);}
function bad(tool,s){return tool==='fire'?s==='fault':/^(off|blur|fault)$/.test(s);}
function capture(tool,events,before,after,opt){
  opt=opt||{};var date=opt.date||S.ymd(),old={},next={},made=[];
  before.forEach(function(r){old[key(r)]=r;});after.forEach(function(r){next[key(r)]=r;});
  Object.keys(Object.assign({},old,next)).forEach(function(id){
    var a=old[id],b=next[id],av=fields(tool,a),bv=fields(tool,b),force=opt.kind==='replace'&&(!opt.id||id===opt.id);
    if(JSON.stringify(av)===JSON.stringify(bv)&&!force)return;
    if(b)b._assetState=S.replaceObject(bv,new Date().toISOString());
    var kind=!a?'add':!b?'remove':force?'replace':bad(tool,b.status)&&!bad(tool,a.status)?'fault':bad(tool,a.status)&&!bad(tool,b.status)?'recovered':'update';
    var signature=JSON.stringify([tool,id,date,kind,bv||av,opt.reason||'']);
    var event={id:'AC-'+tool+'-'+hash(signature),assetId:id,date:date,kind:kind,before:av,after:bv,photos:kind==='remove'||kind==='recovered'?[]:photos(b),by:opt.by||S.getCfg().operator||'',reason:opt.reason||'',source:opt.source||'master',createdAt:new Date().toISOString()};
    if(!events.some(function(e){return e.id===event.id;})){events.push(event);made.push(event);}
  });return made;
}
function refreshStates(tool,rows){rows.forEach(function(r){if(r._assetState){var f=fields(tool,r),old=S.unwrapObject(r._assetState).data;if(JSON.stringify(f)!==JSON.stringify(old))r._assetState=S.replaceObject(f,new Date().toISOString());}});}
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
function selected(events,st,match){var p=period(st),seen={};return events.filter(function(e){var yes=e.date&&p.has(e.date)&&(!match||match(st,e.after||e.before||{}))&&!seen[e.id];seen[e.id]=true;return yes;}).sort(function(a,b){return String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id));});}
function label(kind,lang){var a={add:['新增','Added'],remove:['移除','Removed'],replace:['更換新品','Replaced'],fault:['異常／更新證據','Fault / evidence'],recovered:['恢復正常','Recovered'],update:['資料更新','Updated']}[kind]||['更新','Updated'];return lang==='en'?a[1]:a[0];}
function pages(tool,events,st,match){
  var rows=selected(events,st,match),title=(tool==='fire'?'🧯 消防設備異動 / Fire equipment changes':'📷 CCTV 設備異動 / Camera changes')+' · '+S.esc(period(st).label()),count={},seen={},defs=[],lines=[],ph=[];
  rows.forEach(function(r){count[r.kind]=(count[r.kind]||0)+1;});
  var head='<b>'+title+'</b>\n'+(rows.length?Object.keys(count).map(function(k){return label(k,st.lang)+' '+count[k];}).join(' · '):'✅ 本期無異動，沿用既有設備資料。 / No changes; existing equipment remains in use.');
  function flush(){if(lines.length){defs.push({text:(defs.length?'<b>'+title+'</b>':head)+'\n'+lines.join('\n'),photos:ph});lines=[];ph=[];}}
  rows.forEach(function(e){var r=e.after||e.before||{},a=e.before||{},b=e.after||{},diff=[];
    FIELDS[tool].forEach(function(k){if(['code','loc','name','x','y','remark'].indexOf(k)>=0)return;if(a[k]!==b[k]&&e.before&&e.after)diff.push(k+' '+(a[k]||'—')+' → '+(b[k]||'—'));});
    var line=(e.kind==='fault'?'⚠️ ':e.kind==='recovered'?'✅ ':'· ')+S.esc(e.date)+' · '+label(e.kind,st.lang)+' · <b>'+S.esc((r.code||'—')+' · '+(r.loc||r.name||r.zone||'—'))+'</b>'+(diff.length?' · '+S.esc(diff.join(' · ')):'')+(e.reason?' · '+S.esc(e.reason):'')+(e.by?' · '+S.esc(e.by):'');
    var photosToSend=(e.photos||[]).filter(function(p){if(seen[p])return false;seen[p]=true;return true;});
    if(lines.length&&(lines.length>=8||lines.join('\n').length+line.length>2500||ph.length+photosToSend.length>4))flush();
    lines.push(line);ph=ph.concat(photosToSend.slice(0,4));if(photosToSend.length>4)flush();
    for(var i=4;i<photosToSend.length;i+=4)defs.push({text:'<b>'+title+'</b>\n'+line,photos:photosToSend.slice(i,i+4)});
  });flush();if(!defs.length)defs.push({text:head,photos:[]});return defs;
}
function resetEditor(id){var d=document.getElementById('e_assetDate'),k=document.getElementById('e_assetKind');if(d)d.value=S.ymd();if(k){k.value='update';k.disabled=!id;}}
function editorOptions(id){var d=document.getElementById('e_assetDate');if(!d||!/^\d{4}-\d{2}-\d{2}$/.test(d.value))throw Error('請填寫異動日期 / Enter change date');return {id:id,date:d.value,kind:document.getElementById('e_assetKind').value};}
function open(opt){return S.tgOpen({module:opt.tool,hideDetails:true,reportKind:'masterChanges',modalTitle:opt.tool==='fire'?'消防設備異動摘要 / Equipment changes':'CCTV 設備異動摘要 / Camera changes',defaultType:opt.period.mode,defaultPeriod:opt.period.key(),defaultLang:'both',currentPeriod:function(type){return new S.Period(type,opt.period.at).key();},scopeOptions:opt.scopeOptions,defaultScope:'all',periods:function(type){var seen={};opt.events().forEach(function(e){if(e.date)seen[new S.Period(type,S.parseD(e.date)).key()]=1;});return Object.keys(seen);},summaryPages:function(st){return pages(opt.tool,opt.events(),st,opt.match).map(function(p){return p.text;});},summaryPhotos:function(st,i){var p=pages(opt.tool,opt.events(),st,opt.match)[i];return p?p.photos:[];},beforeSummarySend:async function(){await opt.save();if(!await opt.upload())throw Error('雲端更新失敗，請重試 / Cloud save failed');}});}
S.AssetChanges={refreshStates:refreshStates,clone:clone,capture:capture,inspectionEvents:inspectionEvents,selected:selected,pages:pages,resetEditor:resetEditor,editorOptions:editorOptions,open:open};
})(window);
