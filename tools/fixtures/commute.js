GATE=[{id:'G1',date:'2026-10-01',plate:'3D-1344',driver:'Hok dy',pax:1,outTime:'14:30',inTime:'13:53',km:0,passenger:'',dept:'taxi',reason:'take cutting pes to pp',photos:['data:image/png;base64,AA','data:image/png;base64,BB']},
 {id:'G2',date:'2026-10-01',plate:'2A-5531',driver:'Sok Chea',pax:3,inTime:'08:10',outTime:'11:45',km:42,passenger:'Phea',dept:'GA',reason:'bank'}];
LATE=[];['3958 min savoeun production','5840 khem sreyka production','5966 khem tola production','933 neang pov production'].forEach((x,i)=>{const p=x.split(' ');LATE.push({id:'L'+i,date:'2026-10-01',empId:p[0],name:p[1]+' '+p[2],dept:p[3],checkIn:'07:32',gate:'vin'});});
LATE.push({id:'L9',date:'2026-10-01',empId:'6022',name:'in chanchav',dept:'cutting',checkIn:'07:41',gate:'vin',note:'flat tire'});
for(let d=15;d<=30;d+=3){LATE.push({id:'LX'+d,date:'2026-09-'+d,empId:'3958',name:'min savoeun',dept:'production',checkIn:'07:35'});}
CAR=[{id:'C1',date:'2026-10-01',driver:'Hok dy',plate:'3D-1344',category:'local',outTime:'09:00',inTime:'10:30',km:12,reason:'buy parts',approver:'Paul',approvalStatus:'approved'}];
BIKE=[{id:'B1',date:'2026-10-01',a:171,b:33,total:204}];
renderAll&&renderAll();
