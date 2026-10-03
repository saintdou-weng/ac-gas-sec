/* Preview fixture: 13 guards on the roster since August, September 2026 changes (join, resign, shift, transfer).
   Run with scope 'allChanges' to see every change in the period. */
(function () {
  var P = SEC.Personnel, people = [
    ['A01','Nhanh Pov','A','Front Gate'], ['A02','Nhem Samphors','A','Front Gate'], ['A03','Pon Moch','A','Building B'],
    ['A04','Su Sopheak','A','Building B'], ['A05','Uk Bo','A','Staff House'], ['A06','Chea Dara','A','Front Gate'],
    ['A07','Sok Vanna','A','Building B'], ['A08','Kim Rithy','A','Staff House'], ['A09','Mao Sokha','C','Front Gate'],
    ['A10','Heng Vibol','C','Building B'], ['A11','Lim Chenda','C','Staff House'], ['A12','Ouk Sambath','C','Front Gate'],
    ['A13','Phan Sreyneang','C','Building B']
  ];
  DB = []; CHG = [];
  people.forEach(function (p) {
    P.apply(DB, CHG, { empId:p[0], name:p[1], shift:p[2], post:p[3], position:'保安員 Security Guard', company:'GS Security', phone:'012 345 6' + p[0].slice(1), status:'active' },
      { month:'2026-08', date:'2026-08-01', kind:'join', reason:'Excel import / Excel 匯入', by:'Phea' });
  });
  var find = function (id) { return DB.filter(function (r) { return r.empId === id; })[0]; };
  P.apply(DB, CHG, { empId:'A14', name:'Sok Chea', shift:'C', post:'Front Gate', position:'保安員 Security Guard', company:'GS Security', status:'active', photo:'data:image/png;base64,QUFB' },
    { month:'2026-09', date:'2026-09-03', kind:'join', reason:'Replace A02', by:'Phea' });
  P.apply(DB, CHG, Object.assign({}, P.snapshot(find('A02'), '2026-09'), { status:'resigned' }),
    { id:find('A02').id, month:'2026-09', date:'2026-09-25', kind:'resign', reason:'Moved to Phnom Penh', by:'Phea' });
  P.apply(DB, CHG, Object.assign({}, P.snapshot(find('A05'), '2026-09'), { shift:'C' }),
    { id:find('A05').id, month:'2026-09', date:'2026-09-15', kind:'shift', reason:'Night cover', by:'Phea' });
  P.apply(DB, CHG, Object.assign({}, P.snapshot(find('A10'), '2026-09'), { post:'Staff House' }),
    { id:find('A10').id, month:'2026-09', date:'2026-09-15', kind:'transfer', by:'Phea' });
  ROSTER = {};
  PER.at = new Date(2026, 8, 1);
  renderAll();
})();
