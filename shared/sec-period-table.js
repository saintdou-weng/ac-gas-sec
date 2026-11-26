/* sec-period-table.js — 日／週／月／年 的期間總表（2026-11-26 Paul：學 sewing 的方式，所有頁一體適用）
   sewing 的做法：
     日 → 當天明細（本表不顯示）
     週 → 這一週每天一列（星期一～日），沒資料的天標「—」，一眼看出哪天沒做
     月 → 每個月一列（月別報表），本月標亮
     年 → 每年一列（年別報表）
   每列有數字欄＋一條彩色長條；點一列就跳到那一天／那個月／那一年。
   用法：SEC.periodTable(host, { per:PER, rows:[...], date:function(r){return r.date;},
           metrics:[{ zh:'正常', en:'Normal', km:'…', color:'#16a34a', v:function(list){return n;} }, …],
           bar:[0,1] (要畫進長條的欄，預設全部), title:{zh,en,km}, onPick:function(){ renderAll(); } }) */
(function (g) {
  'use strict';
  var S = g.SEC; if (!S || S.periodTable) return;
  function L(zh, en, km) { var l = S.lang ? S.lang() : 'zh'; return l === 'en' ? en : l === 'km' ? (km || en) : zh; }
  function esc(v) { return S.esc ? S.esc(v) : String(v == null ? '' : v); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  var WD = { zh:'日一二三四五六', en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], km:['អា','ច','អ','ពុ','ព្រ','សុ','ស'] };
  function wd(d) { var l = S.lang ? S.lang() : 'zh'; return l === 'zh' ? '週' + WD.zh.charAt(d.getDay()) : (WD[l] || WD.en)[d.getDay()]; }
  function css() {
    if (document.getElementById('sec-ptab-css')) return;
    var st = document.createElement('style'); st.id = 'sec-ptab-css';
    st.textContent = '.sptab{margin:8px 0 12px}.sptab h4{margin:0 0 6px;font-size:13.5px;display:flex;justify-content:space-between;align-items:center;gap:6px}' +
      '.sptab table{width:100%;border-collapse:collapse;font-size:12.5px}.sptab th{font-size:11px;color:var(--ink2,#64748b);font-weight:700;text-align:right;padding:4px 5px;border-bottom:2px solid var(--line,#e2e6f0);white-space:nowrap}.sptab th:first-child{text-align:left}' +
      '.sptab td{padding:6px 5px;border-bottom:1px solid var(--line,#eef2f6);text-align:right;white-space:nowrap}.sptab td:first-child{text-align:left;font-weight:800}' +
      '.sptab tr.pk{cursor:pointer}.sptab tr.pk:active td,.sptab tr.pk:hover td{background:rgba(59,130,246,.07)}.sptab tr.cur td{background:rgba(13,148,136,.1)}.sptab tr.nod td{color:#94a3b8}' +
      '.sptab .bar{display:flex;height:10px;border-radius:4px;overflow:hidden;background:#eef2f6;min-width:50px}.sptab .bar i{display:block;height:100%}.sptab td.bc{width:28%}' +
      '.sptab tfoot td{font-weight:800;border-top:2px solid var(--line,#e2e6f0);background:rgba(13,148,136,.06)}' +
      '@media(max-width:720px){.sptab td.bc{display:none}.sptab th.bc{display:none}}';
    document.head.appendChild(st);
  }
  function periodTable(host, o) {
    if (typeof host === 'string') host = document.getElementById(host);
    if (!host || !o || !o.per) return;
    css();
    var per = o.per, mode = per.mode;
    if (mode === 'day') { host.innerHTML = ''; return; }
    var dateOf = o.date || function (r) { return r.date; }, rows = (o.rows || []).filter(function (r) { return r && !r._deleted && /^\d{4}-\d{2}/.test(String(dateOf(r) || '')); });
    var groups = [], idx = {};
    function add(k, label, sub, pick, cur) { var gp = { k:k, label:label, sub:sub || '', list:[], pick:pick, cur:!!cur }; groups.push(gp); idx[k] = gp; return gp; }
    if (mode === 'week') {
      var r = per.range(), d = new Date(r.fromD), today = ymd(new Date());
      for (var i = 0; i < 7; i++) { var k = ymd(d); add(k, k.slice(5), wd(d), { m:'day', at:new Date(d) }, k === today); d.setDate(d.getDate() + 1); }
      rows.forEach(function (x) { var k = String(dateOf(x)).slice(0, 10); if (idx[k]) idx[k].list.push(x); });
    } else if (mode === 'month') {
      var curM = per.key(), seen = {}; rows.forEach(function (x) { seen[String(dateOf(x)).slice(0, 7)] = 1; }); seen[curM] = 1;
      Object.keys(seen).sort().reverse().slice(0, o.maxMonths || 24).forEach(function (k) { add(k, k, '', { m:'month', at:new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, 1) }, k === curM); });
      rows.forEach(function (x) { var k = String(dateOf(x)).slice(0, 7); if (idx[k]) idx[k].list.push(x); });
    } else {
      var curY = per.key(), sy = {}; rows.forEach(function (x) { sy[String(dateOf(x)).slice(0, 4)] = 1; }); sy[curY] = 1;
      Object.keys(sy).sort().reverse().forEach(function (k) { add(k, k, '', { m:'year', at:new Date(+k, 0, 1) }, k === curY); });
      rows.forEach(function (x) { var k = String(dateOf(x)).slice(0, 4); if (idx[k]) idx[k].list.push(x); });
    }
    var ms = o.metrics || [], barIx = o.bar || ms.map(function (_, i) { return i; });
    groups.forEach(function (gp) { gp.vals = ms.map(function (m) { var v = gp.list.length ? m.v(gp.list, gp) : (m.empty != null ? m.empty : null); return v; }); });
    var mx = Math.max.apply(null, groups.map(function (gp) { return barIx.reduce(function (a, i) { return a + (+gp.vals[i] || 0); }, 0); })) || 1;
    var tot = ms.map(function (m, i) { if (m.total === false) return ''; if (typeof m.total === 'function') return m.total(rows.filter(function (x) { return groups.some(function (gp) { return gp.list.indexOf(x) >= 0; }); })); return groups.reduce(function (a, gp) { return a + (+gp.vals[i] || 0); }, 0); });
    var fmt = function (v, m) { if (v == null || v === '') return '—'; return (m.fmt ? m.fmt(v) : esc(String(v))); };
    var title = o.title ? L(o.title.zh, o.title.en, o.title.km) : (mode === 'week' ? L('本週每天', 'Each day this week', 'រៀងរាល់ថ្ងៃសប្តាហ៍នេះ') : mode === 'month' ? L('月別總表', 'By month', 'តាមខែ') : L('年別總表', 'By year', 'តាមឆ្នាំ'));
    var hint = mode === 'week' ? L('點一天看當天明細', 'Tap a day for its detail', 'ចុចថ្ងៃដើម្បីមើល') : mode === 'month' ? L('點一個月跳到那個月', 'Tap a month to open it', 'ចុចខែដើម្បីបើក') : L('點一年跳到那一年', 'Tap a year to open it', 'ចុចឆ្នាំដើម្បីបើក');
    var head = '<tr><th>' + esc(mode === 'week' ? L('日期', 'Date', 'កាលបរិច្ឆេទ') : mode === 'month' ? L('月份', 'Month', 'ខែ') : L('年', 'Year', 'ឆ្នាំ')) + '</th>' + ms.map(function (m) { return '<th style="color:' + (m.color || 'inherit') + '">' + esc(L(m.zh, m.en, m.km)) + '</th>'; }).join('') + '<th class="bc"></th></tr>';
    var body = groups.map(function (gp, gi) {
      var sum = barIx.reduce(function (a, i) { return a + (+gp.vals[i] || 0); }, 0);
      var bar = '<div class="bar" style="width:' + Math.max(4, sum / mx * 100) + '%">' + barIx.map(function (i) { var v = +gp.vals[i] || 0; return v ? '<i style="flex:' + v + ';background:' + (ms[i].color || '#64748b') + '"></i>' : ''; }).join('') + '</div>';
      return '<tr class="pk' + (gp.cur ? ' cur' : '') + (gp.list.length ? '' : ' nod') + '" data-gi="' + gi + '"><td>' + esc(gp.label) + (gp.sub ? ' <small style="font-weight:600;color:var(--ink2,#64748b)">' + esc(gp.sub) + '</small>' : '') + (!gp.list.length && mode === 'week' ? ' <small style="color:#d97706">' + esc(L('無紀錄', 'none', 'គ្មាន')) + '</small>' : '') + '</td>' +
        ms.map(function (m, i) { var v = gp.vals[i], c = m.colorFn ? m.colorFn(v, gp) : (v ? m.color : ''); return '<td' + (c ? ' style="color:' + c + ';font-weight:800"' : '') + '>' + fmt(v, m) + '</td>'; }).join('') + '<td class="bc">' + (gp.list.length ? bar : '') + '</td></tr>';
    }).join('');
    var foot = '<tfoot><tr><td>Σ ' + esc(L('合計', 'Total', 'សរុប')) + '</td>' + ms.map(function (m, i) { return '<td>' + (tot[i] === '' ? '' : fmt(tot[i], m)) + '</td>'; }).join('') + '<td class="bc"></td></tr></tfoot>';
    host.innerHTML = '<div class="sptab"><h4><span>📅 ' + esc(title) + '</span><small style="font-weight:600;color:var(--ink2,#64748b)">' + esc(hint) + '</small></h4><div class="tw" style="overflow-x:auto"><table><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div></div>';
    host.querySelectorAll('tr.pk').forEach(function (tr) {
      tr.onclick = function () {
        var gp = groups[+tr.dataset.gi]; if (!gp || !gp.pick) return;
        per.mode = gp.pick.m; per.at = gp.pick.at;
        var nav = document.querySelector('.pnav .pmode button[data-m="' + gp.pick.m + '"]');
        if (nav) nav.click(); else if (o.onPick) o.onPick(gp);
        try { (document.querySelector('.pnav') || host).scrollIntoView({ block:'start', behavior:'smooth' }); } catch (e) {}
      };
    });
  }
  S.periodTable = periodTable;
})(window);
