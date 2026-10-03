/* Fire preview fixture: ~35 extinguishers across A / B factory zones, September inspection by Jenny (2 faults) + Phea. */
(function(){
  var seed=(window.FIRE_XLS_SEED||[]).filter(function(e){return e.type==='ext'&&+e.code.slice(2)<=43;}).slice(0,35);
  DB=seed.map(function(e,i){
    var o=Object.assign({},e,{id:'FX'+e.code,status:'ok',remark:'',last:'2026-09-12',photos:[]});
    if(e.code==='FE16')o.expiryDate='2026-10-20';            /* due soon */
    else if(e.code==='FE29')o.expiryDate='2026-09-25';       /* date passed */
    else o.expiryDate='2027-0'+(1+i%9)+'-15';
    return o;
  });
  var faults={FE09:'Pin missing',FE27:'Pressure low'};
  var jenny=DB.slice(0,30).map(function(e){
    var bad=!!faults[e.code];
    return {id:e.id,code:e.code,type:e.type,factory:e.factory,zone:e.zone,loc:e.loc,result:bad?'fault':'ok',note:bad?faults[e.code]:'',photos:bad?['data:image/png;base64,'+e.code+'a']:[]};
  });
  var phea=DB.slice(30,33).map(function(e){return {id:e.id,code:e.code,type:e.type,factory:e.factory,zone:e.zone,loc:e.loc,result:'ok',note:'',photos:[]};});
  HIST=[{id:'H0912',date:'2026-09-12',by:'Jenny',items:jenny,photos:[]},{id:'H0913',date:'2026-09-13',by:'Phea',items:phea,photos:[]}];
  PER=new SEC.Period('month',new Date(2026,8,12));
})();
