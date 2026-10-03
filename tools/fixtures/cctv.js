/* CCTV preview fixture: 35 cameras (A-01..A-19, B-01..B-16), areas Front Gate / Building A / Finishing WH / Building B / Office,
   September daily checks by Sreynin; on the latest check one camera is offline. */
(function(){
  var zonesA=['gate','gate','bldA','bldA','bldA','bldA','bldA','bldA','bldA','bldA','bldA','bldA','fwh','fwh','fwh','fwh','office','office','office'];
  var zonesB=['gate','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','bldB','office','office'];
  DB=[];
  zonesA.forEach(function(z,i){DB.push({id:'CA'+(i+1),code:'CCTV A-'+String(i+1).padStart(2,'0'),name:'',factory:'a',zone:z,type:'dome',nvr:'NVR-1',ch:String(i+1),status:'ok',remark:''});});
  zonesB.forEach(function(z,i){DB.push({id:'CB'+(i+1),code:'CCTV B-'+String(i+1).padStart(2,'0'),name:'',factory:'b',zone:z,type:'dome',nvr:'NVR-2',ch:String(i+1),status:'ok',remark:''});});
  DB[4].name='Line 3 aisle';DB[4].remark='Cable cut by forklift';
  LOG=[];
  for(var d=1;d<=30;d++){
    var date='2026-09-'+String(d).padStart(2,'0'),wd=new Date(2026,8,d).getDay();if(wd===0)continue;
    var st={};DB.forEach(function(c){st[c.id]='ok';});
    var last=d===30;if(last)st[DB[4].id]='off';
    var bad=last?1:0;
    LOG.push({id:'L'+d,date:date,by:'Sreynin',note:last?'A-05 offline, IT informed':'',n:DB.length,ok:DB.length-bad,off:bad,blur:0,fault:0,dis:0,uptime:Math.round((DB.length-bad)/DB.length*100),
      badList:last?['CCTV A-05 (Offline)']:[],st:st,photos:last?['data:image/png;base64,A05off']:[],cameras:DB.map(function(c){return {id:c.id,code:c.code,factory:c.factory,zone:c.zone};})});
  }
  LOG.sort(function(a,b){return b.date.localeCompare(a.date);});
  PER=new SEC.Period('month',new Date(2026,8,30));
})();
