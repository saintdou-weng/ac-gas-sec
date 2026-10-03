/* Telegram preview fixture for ac_sec_container_v2.html
   Sept 2026: 9 container trucks (one still inside, one with exit time before entry), 3 inspections (one fail), 2 gate/delivery notes. */
var P = 'data:image/png;base64,';
TK = [
  { id:'T1', date:'2026-09-12', name:'LEAM LAY', licence:'L-5521', containerNo:'ZCSU697747', truckNo:'3E-4197', company:'SIN PIC', isImport:false, isExport:true, timeIn:'12:39', signIn:'Vin', timeOut:'13:58', signOut:'ISAY', remark:'40FT, seal 1182233', entryPhotos:[P+'VDFJ'], exitPhotos:[P+'VDFP'] },
  { id:'T2', date:'2026-09-12', name:'SOK DARA', containerNo:'MSKU4410023', truckNo:'3C-7781', company:'Maersk', isImport:true, isExport:false, timeIn:'08:05', signIn:'Vin', timeOut:'10:20', signOut:'Vin', remark:'', entryPhotos:[], exitPhotos:[] },
  { id:'T3', date:'2026-09-15', name:'CHHUN VY', containerNo:'TGHU8812290', truckNo:'2B-1408', company:'SIN PIC', isImport:false, isExport:true, timeIn:'09:10', signIn:'ISAY', timeOut:'11:02', signOut:'ISAY', remark:'' },
  { id:'T4', date:'2026-09-17', name:'MEAS RITH', containerNo:'CMAU5503117', size:'20', truckNo:'3A-0921', company:'CMA CGM', isImport:true, isExport:false, timeIn:'14:30', signIn:'Vin', timeOut:'13:50', signOut:'ISAY', remark:'out time looks wrong' },
  { id:'T5', date:'2026-09-19', name:'LEAM LAY', containerNo:'ZCSU698120', size:'40', truckNo:'3E-4197', company:'SIN PIC', isImport:false, isExport:true, timeIn:'07:45', signIn:'Vin', timeOut:'09:15', signOut:'Vin', remark:'' },
  { id:'T6', date:'2026-09-23', name:'KEO SAMBO', containerNo:'MSKU4410777', truckNo:'3C-7781', company:'Maersk', isImport:true, isExport:false, timeIn:'10:00', signIn:'ISAY', timeOut:'11:40', signOut:'Vin', remark:'' },
  { id:'T7', date:'2026-09-26', name:'CHHUN VY', containerNo:'TGHU8812555', truckNo:'2B-1408', company:'SIN PIC', isImport:false, isExport:true, timeIn:'13:15', signIn:'Vin', timeOut:'14:35', signOut:'ISAY', remark:'' },
  { id:'T8', date:'2026-09-29', name:'PICH SOVANN', containerNo:'OOLU7100345', truckNo:'3D-2260', company:'OOCL', isImport:true, isExport:false, timeIn:'15:20', signIn:'Vin', timeOut:'', signOut:'', remark:'waiting for unloading', entryPhotos:[P+'VDhJ'] },
  { id:'T9', date:'2026-09-30', name:'LEAM LAY', containerNo:'ZCSU699001', size:'40HQ', truckNo:'3E-4197', company:'SIN PIC', isImport:false, isExport:true, timeIn:'08:30', signIn:'ISAY', timeOut:'09:41', signOut:'ISAY', remark:'' }
];
CI = [
  { id:'C1', date:'2026-09-12', containerNo:'ZCSU697747', seal:'1182233', truck:'3E-4197', company:'SIN PIC', by:'Vin', pass:17, result:'pass', fails:[], checks:{}, items:[{ name:'Shirts', qty:'420', unit:'ctn' }], photos:[P+'QzE='] },
  { id:'C2', date:'2026-09-15', containerNo:'TGHU8812290', seal:'1182290', truck:'2B-1408', company:'SIN PIC', by:'ISAY', pass:15, result:'fail', fails:['floor', 'right'], checks:{}, note:'Floor wet, waited 30 min to dry', photos:[P+'QzI='] },
  { id:'C3', date:'2026-09-26', containerNo:'TGHU8812555', seal:'1182555', truck:'2B-1408', company:'SIN PIC', by:'Vin', pass:17, result:'pass', fails:[], checks:{} }
];
GD = [
  { id:'G1', type:'gp', no:'GP-0912', date:'2026-09-12', time:'16:10', dept:'GA', by:'Phea', vehicle:'3A-1111', reasons:['repair'], items:[{ name:'Sewing motor', qty:'2', unit:'pc' }], photos:[] },
  { id:'G2', type:'dn', no:'DN-0930', date:'2026-09-30', time:'09:00', dept:'Shipping', by:'Phea', vehicle:'3E-4197', reasons:['fg'], items:[{ name:'Cartons', qty:'380', unit:'ctn' }], note:'With container ZCSU699001' }
];
PER = new SEC.Period('month', new Date(2026, 8, 1));
renderAll && renderAll();
