/* Preview fixture: September 2026 — 11 "Security service fee" rows at $300 (= $3,300; 5 pending in a batch, 6 not sent)
   plus 2 general expenses (uniform, radio repair) that need no approval. */
(function () {
  var guards = ['Nhanh Pov','Nhem Samphors','Pon Moch','Su Sopheak','Uk Bo','Chea Dara','Sok Vanna','Kim Rithy','Mao Sokha','Heng Vibol','Lim Chenda'];
  DB = guards.map(function (g, i) {
    var n = i + 1, pend = i < 5;
    return { id:'e' + n, code:'SVC-202609-' + ('00' + n).slice(-3), date:'2026-09-01', name:'Security service fee', cat:'保安服務費 Security Service',
      vendor:'GS Security', qty:1, unit:'人月', price:300, amount:300, reason:(i < 7 ? '日班 Day' : '夜班 Night') + ' · ' + g, by:'Phea',
      batchId:pend ? 'B20260930-01' : '', apprStatus:pend ? 'pending' : '', photos:i === 0 ? ['data:image/png;base64,QUFB'] : [] };
  });
  DB.push({ id:'u1', code:'EXP-202609-001', date:'2026-09-12', name:'Raincoat', cat:'制服 Uniform', vendor:'Phsar Leu', qty:3, unit:'pcs', price:15, amount:45, reason:'Rainy season', by:'Phea', photos:['data:image/png;base64,QkJC'] });
  DB.push({ id:'r1', code:'EXP-202609-002', date:'2026-09-18', name:'Radio repair', cat:'維修 Repair', vendor:'Tech Shop', qty:1, unit:'set', price:20, amount:20, by:'Phea', photos:[] });
  PER.at = new Date(2026, 8, 1);
  renderAll();
})();
