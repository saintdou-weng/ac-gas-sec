/* Telegram preview fixture for ac_sec_patrol_v2.html
   10 night rounds/day 09-14..09-30 by 5 guards; 09-19 one round misses 2 points; 09-22 only 8 rounds (short night);
   09-21 completion check: lighting ❌ with note + photo; one manual issue. */
CHIP = {}; CP_BASELINE_APPLIED = ''; applyAttachmentCheckpointBaseline();
document.getElementById('nightMin').value = '10';
var GUARDS = ['Chao Bros', 'Kun Vin', 'Nhim Sompose', 'Su Sopheak', 'Uk Bo'];
var pad2 = function (n) { return String(n).padStart(2, '0'); };
var cps = ATTACHMENT_LATEST_CP.slice();
SCAN = []; MAN = []; CHECK = [];
for (var day = 14; day <= 30; day++) {
  var date = '2026-09-' + pad2(day), n = day === 22 ? 8 : 10;
  for (var i = 0; i < n; i++) {
    var start = 17 * 60 + 30 + i * 40, g = GUARDS[i % 5];
    cps.forEach(function (c, k) {
      if (day === 19 && i === 7 && (k === 4 || k === 9)) return; /* 漏 2 點 */
      var m = start + k * 2;
      SCAN.push({ t: date + ' ' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60) + ':00', g: g, c: c, e: 'N', r: 'R1' });
    });
  }
  var lightsBad = day === 21;
  CHECK.push({ id: date + '|all', date: date, shift: 'all', guard: GUARDS[day % 5],
    checks: { doors: 'ok', windows: 'ok', water: 'ok', electric: 'ok', lights: lightsBad ? 'issue' : 'ok', fireway: 'ok' },
    note: lightsBad ? 'Gate B lamp broken, reported to GA' : '', photos: lightsBad ? ['data:image/png;base64,TElHSFQ='] : [],
    photoNotes: lightsBad ? ['Gate B lamp'] : [], updatedAt: date + 'T23:59:00Z' });
}
MAN = [
  { id: 'M1', date: '2026-09-21', time: '23:15', shift: 'N', guard: 'Uk Bo', location: SUGGEST[0], status: 'issue', note: 'Lamp at gate B not working', photos: ['data:image/png;base64,TUFOMQ=='] },
  { id: 'M2', date: '2026-09-25', time: '20:05', shift: 'N', guard: 'Kun Vin', location: SUGGEST[2], status: 'ok', note: '', photos: [] }
];
PER = new SEC.Period('month', new Date(2026, 8, 1));
rebuild();
