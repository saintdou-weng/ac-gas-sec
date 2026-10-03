/* Preview fixture: 13 security guards, September 2026 attendance (W/O/R/L/A). */
(function () {
  var people = [
    ['A01','Nhanh Pov','A','Front Gate'], ['A02','Nhem Samphors','A','Front Gate'], ['A03','Pon Moch','A','Building B'],
    ['A04','Su Sopheak','A','Building B'], ['A05','Uk Bo','A','Staff House'], ['A06','Chea Dara','A','Front Gate'],
    ['A07','Sok Vanna','A','Building B'], ['A08','Kim Rithy','A','Staff House'], ['A09','Mao Sokha','C','Front Gate'],
    ['A10','Heng Vibol','C','Building B'], ['A11','Lim Chenda','C','Staff House'], ['A12','Ouk Sambath','C','Front Gate'],
    ['A13','Phan Sreyneang','C','Building B']
  ];
  ALL_STAFF = people.map(function (p, i) {
    return { id:'S' + (i + 1), empId:p[0], name:p[1], shift:p[2], post:p[3], position:'Security Guard', status:'active', joinDate:'2025-01-01' };
  });
  var special = {
    A02:{ '08':'L', '09':'L', '10':'L', '22':'A' },
    A05:{ '15':'A', '16':'A' },
    A09:{ '03':'L', '04':'L', '05':'L', '06':'L', '18':'L' },
    A12:{ '27':'A' },
    A13:{ '11':'L' }
  };
  var m = {};
  people.forEach(function (p, i) {
    var row = {};
    for (var d = 1; d <= 30; d++) {
      var dd = (d < 10 ? '0' : '') + d;
      var code = ((d + i) % 7 === 0) ? 'R' : ((d + i) % 9 === 0 ? 'O' : 'W');
      if (special[p[0]] && special[p[0]][dd]) code = special[p[0]][dd];
      row[dd] = code;
    }
    m[p[0]] = row;
  });
  ATT = { '2026-09': m };
  ATT_LOG = [];
  for (var d = 1; d <= 30; d++) {
    var dd = (d < 10 ? '0' : '') + d;
    ['A01', 'A09'].forEach(function (id) {
      var p = people.filter(function (x) { return x[0] === id; })[0];
      if (m[id][dd] === 'W' || m[id][dd] === 'O') ATT_LOG.push({ id:'R' + id + dd, date:'2026-09-' + dd, empId:id, name:p[1], inTime:p[2] === 'C' ? '19:00' : '07:00', outTime:p[2] === 'C' ? '07:00' : '19:00', status:m[id][dd] });
    });
  }
  ATT_INFO = {};
  PER.at = new Date(2026, 8, 1);
  STAFF = attendanceMonthStaff('2026-09');
  renderAll();
})();
