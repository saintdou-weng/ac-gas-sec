/* AC Security 照片表匯入（2026-11-19）
   Paul 11/19：保安人員、CCTV、消防設備各給一份可放圖的 Excel，同事把照片貼進黃色格，丟回來直接匯入。
   ・讀 Excel 裡的圖片（浮動圖片、「放在儲存格內」都可）＋同一列的編號（共用 shared/vrt-photo-import-v1.js 的讀檔方法）。
   ・編號完全一樣才對上（大小寫、空白、- 不計）；匯入前先列出「哪張照片 → 哪個編號」給人確認。
   ・消防／CCTV：新照片放第一張（⭐ 標準照），舊的留著，最多 4 張；同一張不會重複放。保安人員：換成新大頭照。
   ・照片只存在 AC Security 自己的雲端，不和生產／總務／人事共用。 */
(function (g) {
  'use strict';
  var SEC = g.SEC; if (!SEC || SEC.PhotoChart) return;
  function norm(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function esc(s) { return SEC.esc ? SEC.esc(s) : String(s); }
  var CODE_HEAD = /編號|编号|工號|工号|code|\bid\b|id\s*no|លេខកូដ|អត្តលេខ/i;
  function toData(blob, maxW) { return new Promise(function (res) { try { SEC.compressImage(blob, maxW || 760, res); } catch (e) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); } }); }
  function pickFile() { return new Promise(function (res) { var i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx,.xlsm'; i.onchange = function () { res(i.files && i.files[0]); }; i.click(); }); }
  function css() {
    if (document.getElementById('spc-css')) return; var s = document.createElement('style'); s.id = 'spc-css';
    s.textContent = '.spc-bg{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:10px}' +
      '.spc-box{background:#fff;border-radius:14px;max-width:760px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)}' +
      '.spc-h{padding:12px 16px;border-bottom:1px solid #e2e8f0;font-weight:700;font-size:16px}.spc-sum{padding:8px 16px;font-size:13px;color:#334155;background:#f8fafc}' +
      '.spc-list{overflow:auto;padding:8px 12px;flex:1}.spc-row{display:flex;gap:10px;align-items:center;padding:6px;border-bottom:1px solid #f1f5f9}' +
      '.spc-row img{width:84px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0}.spc-row b{color:#b91c1c;font-size:15px}.spc-row small{color:#64748b;display:block}' +
      '.spc-row.bad{background:#fef2f2}.spc-row.bad b{color:#64748b}.spc-row label{margin-left:auto;white-space:nowrap}.spc-f{padding:10px 16px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end}' +
      '.spc-f button{padding:8px 16px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;font-weight:600;cursor:pointer}.spc-f .go{background:#1e3a8a;color:#fff;border-color:#1e3a8a}';
    document.head.appendChild(s);
  }
  async function open(o) {
    var L = o.L || function (zh) { return zh; };
    if (!g.VRTPhotoImport || !g.VRTPhotoImport.readXlsx) { SEC.toast('⚠ ' + L('照片表讀取元件沒有載入', 'Photo chart reader not loaded', 'មិនទាន់ផ្ទុក'), 'warn'); return; }
    var file = await pickFile(); if (!file) return;
    SEC.toast('⏳ ' + L('讀取照片表…', 'Reading photo chart…', 'កំពុងអាន…'), 'info', 2500);
    var logs = [], recs;
    try { recs = await g.VRTPhotoImport.readXlsx(file, function (m) { logs.push(m); }); } catch (e) { SEC.toast('⚠ ' + esc(e.message || e), 'warn', 6000); return; }
    var map = {}; (o.items() || []).forEach(function (it) { if (!it || it._deleted) return; var k = norm(o.keyOf(it)); if (k) (map[k] = map[k] || []).push(it); });
    var rows = [], seen = {};
    recs.forEach(function (r) {
      var cells = r.cells || [], hit = null, raw = '';
      cells.filter(function (c) { return CODE_HEAD.test(c.head || ''); }).concat(cells).some(function (c) { var k = norm(c.text); if (map[k]) { hit = k; raw = c.text; return true; } return false; });
      if (!raw) { var c0 = cells.filter(function (c) { return CODE_HEAD.test(c.head || ''); })[0]; raw = c0 ? c0.text : (r.texts || [])[1] || ''; }
      rows.push({ rec: r, key: hit, raw: raw, dup: hit && seen[hit] ? true : false }); if (hit) seen[hit] = 1;
    });
    if (!rows.length) { SEC.toast('⚠ ' + L('Excel 裡沒有找到照片（請確認照片貼在 Excel 裡，不是連結）', 'No pictures found in the Excel file', 'រកមិនឃើញរូបថត'), 'warn', 6000); return; }
    for (var i = 0; i < rows.length; i++) { rows[i].url = URL.createObjectURL(rows[i].rec.blob); }
    css(); var bg = document.createElement('div'); bg.className = 'spc-bg';
    var ok = rows.filter(function (r) { return r.key && !r.dup; }).length;
    var have = (o.items() || []).filter(function (it) { return it && !it._deleted && norm(o.keyOf(it)); }).length;
    bg.innerHTML = '<div class="spc-box"><div class="spc-h">🖼️ ' + esc(o.title || L('照片表匯入', 'Photo chart import', 'នាំចូលតារាងរូបថត')) + '</div>' +
      '<div class="spc-sum">' + esc(L('照片 ' + rows.length + ' 張，對上編號 ' + ok + ' 張；清單共 ' + have + ' 項',
        rows.length + ' pictures, ' + ok + ' matched to a code; list has ' + have + ' items',
        'រូបថត ' + rows.length + ' ត្រូវគ្នា ' + ok)) + '</div><div class="spc-list">' +
      rows.map(function (r, i) {
        var it = r.key ? map[r.key][0] : null, bad = !r.key || r.dup;
        return '<div class="spc-row' + (bad ? ' bad' : '') + '"><img src="' + r.url + '" alt=""><div><b>' + esc(r.key ? o.keyOf(it) : (r.raw || '—')) + '</b><small>' +
          esc(bad ? (r.dup ? L('同一個編號放了兩張，只用第一張', 'Same code twice — first one used', 'លេខដដែលពីរដង') : L('清單裡沒有這個編號（請檢查編號欄）', 'Code not in the list', 'គ្មានលេខនេះ')) : (o.labelOf ? o.labelOf(it) : '')) +
          '</small><small>' + esc(r.rec.src || '') + '</small></div>' + (bad ? '' : '<label><input type="checkbox" data-i="' + i + '" checked> ' + esc(L('放入', 'Use', 'ប្រើ')) + '</label>') + '</div>';
      }).join('') + '</div><div class="spc-f"><button data-x="1">' + esc(L('取消', 'Cancel', 'បោះបង់')) + '</button><button class="go" data-go="1">✅ ' + esc(L('套用', 'Apply', 'អនុវត្ត')) + '</button></div></div>';
    document.body.appendChild(bg);
    function close() { rows.forEach(function (r) { try { URL.revokeObjectURL(r.url); } catch (_) {} }); bg.remove(); }
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('[data-go]').onclick = async function () {
      var btn = this; btn.disabled = true; btn.textContent = '⏳';
      var picks = [].slice.call(bg.querySelectorAll('input[data-i]:checked')).map(function (x) { return rows[+x.getAttribute('data-i')]; }), n = 0, same = 0;
      for (var k = 0; k < picks.length; k++) {
        var r = picks[k], d = await toData(r.rec.blob, o.maxW);
        map[r.key].forEach(function (it) { var ch = o.apply(it, d); if (ch === false) same++; else n++; });
      }
      close();
      try { await o.done(n); } catch (e) { SEC.toast('⚠ ' + esc(e.message || e), 'warn', 6000); return; }
      SEC.toast('✅ ' + L('已放入 ' + n + ' 張照片' + (same ? '（' + same + ' 張一樣，略過）' : '') + '，正在上傳雲端', n + ' photos added' + (same ? ' (' + same + ' unchanged)' : '') + ' — uploading', 'បានដាក់ ' + n + ' រូប'), 'ok', 6000);
    };
  }
  SEC.PhotoChart = { open: open, norm: norm };
})(window);
