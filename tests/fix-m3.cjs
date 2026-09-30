/* fix-m3：巡邏 / CCTV / 出勤 三頁修正回歸測試（jsdom + 真 Chromium 390x844）
   執行：node tests/fix-m3.cjs   （任何失敗 → exit code 1） */
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert/strict');
const { load } = require('./dom-harness.cjs');
const CJK = /[㐀-鿿豈-﫿]/;
const KM = /[ក-៿]/;
const LEGIT = new Set(['繁中']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function pass(msg) { passed++; console.log('PASS: ' + msg); }
function cjkIn(s) { return CJK.test(String(s || '')); }
/* 可見文字（含 option、placeholder/title/aria-label），略過 script/style 與語言按鈕 */
function cjkTexts(w) {
  const out = [], doc = w.document;
  const tw0 = doc.getElementById('toastwrap'); if (tw0) tw0.innerHTML = '';   /* 舊語言的 toast 在真瀏覽器 3 秒後消失 */
  const tw = doc.createTreeWalker(doc.body, w.NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
    if (el.closest('.lang-sw')) continue;
    const s = n.nodeValue.trim(); if (s && CJK.test(s) && !LEGIT.has(s)) out.push(s.slice(0, 90));
  }
  doc.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v && CJK.test(v)) out.push('@' + a + ':' + v); }));
  if (CJK.test(doc.title)) out.push('<title>' + doc.title);
  return out;
}
/* Excel 真正儲存的日期時間＝序號＋日期格式。直接算序號（避免 SheetJS 寫入 Date 時的 LMT 秒差）。 */
function serialOf(dt) { return (Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds()) - Date.UTC(1899, 11, 30)) / 86400000; }
function sheetFromAoa(X, aoa) {
  const rows = aoa.map(r => r.map(c => (c && typeof c.getTime === 'function') ? serialOf(c) : c));
  const ws = X.utils.aoa_to_sheet(rows);
  aoa.forEach((r, ri) => r.forEach((c, ci) => { if (c && typeof c.getTime === 'function') { const a = X.utils.encode_cell({ r:ri, c:ci }); ws[a].z = (c.getHours() || c.getMinutes() || c.getSeconds()) ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd'; } }));
  return ws;
}
function xlsxRows(w, aoa, sheetName) {
  const X = w.XLSX, wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, sheetFromAoa(X, aoa), sheetName || 'Sheet1');
  const buf = X.write(wb, { type:'array', bookType:'xlsx' });
  /* 與共用 readWorkbook 新設定一致：cellDates:false、raw:true → 日期為 Excel 序號、時間為小數 */
  const rb = X.read(new Uint8Array(buf), { type:'array', cellDates:false, raw:true });
  return rb.SheetNames.map(n => ({ name:n, fileName:'test.xlsx', rows:X.utils.sheet_to_json(rb.Sheets[n], { header:1, defval:'', raw:true, blankrows:false }) }));
}
function captureExport(w) {
  const got = [];
  w.SEC.exportExcel = (sheets) => { got.push(JSON.parse(JSON.stringify(sheets))); };
  return got;
}
function exportCjk(sheets) {
  const bad = [];
  sheets.forEach(s => (s.rows || []).forEach(r => {
    if (Array.isArray(r)) r.forEach(c => { if (typeof c === 'string' && CJK.test(c)) bad.push(c); });
    else Object.keys(r).forEach(k => { if (CJK.test(k)) bad.push('header:' + k); if (typeof r[k] === 'string' && CJK.test(r[k])) bad.push(r[k]); });
  }));
  return bad;
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
/* jsdom 的 runScripts:'outside-only' 不執行 onclick 屬性；接上等效監聽器，點擊時 window.event 與真瀏覽器相同。 */
function wire(w, el) { const code = el.getAttribute('onclick'); if (code && !el.__wired) { el.__wired = 1; el.addEventListener('click', function () { new w.Function(code).call(el); }); } return el; }

(async () => {
  /* ═════════ 巡邏 ═════════ */
  {
    const P = await load('ac_sec_patrol_v2.html'), w = P.w, d = w.document, SEC = w.SEC;
    await sleep(250);
    try {
      assert.deepEqual(P.errors, []);
      SEC.setLang('zh');
      const tabs = [...d.querySelectorAll('#tabs .tab')].map(b => b.dataset.p);
      assert.deepEqual(tabs.slice(0, 3), ['check', 'new', 'iss'], 'guards see 巡邏確認 / 線上登錄 / 異常通報 first');
      assert.equal(tabs[tabs.length - 1], 'data', 'data/admin tab last');
      assert(d.querySelector('#tabs .tab.on').dataset.p === 'check' && d.getElementById('p-check').style.display !== 'none');
      assert(d.getElementById('tabsWrap') && /\.tabs-wrap::after\{content:'›'/.test(d.querySelector('head style').textContent), 'tab bar has a visible scroll hint (fade + ›)');
      pass('patrol: 3 guard tabs first, admin/data last, scrollable tab bar');

      /* 日期預設今天；期間導覽只影響清單 */
      const today = SEC.ymd();
      w.SCAN = [{ t:'2025-01-05 22:10:00', g:'Guard A', c:'0F004EBEFC', e:'N', r:'R1' }];
      w.jumpPatrolToLatest(); w.rebuild();
      assert.equal(d.getElementById('pcDate').value, today, 'pcDate = today even when data is in an older month');
      w.PER.shift(-3); w.renderAll();
      assert.equal(d.getElementById('pcDate').value, today, 'period navigation must not move the confirmation date');
      for (const id of ['nDate', 'iDate']) assert.equal(d.getElementById(id).value, today, id + ' defaults to today');
      pass('patrol: daily-confirm/manual/issue dates default to today; period nav affects lists only');

      /* 巡邏員預設上次使用者／設定 operator */
      SEC.setCfg({ operator:'Operator X' });
      w.resetManForm(); assert.equal(d.getElementById('nGuard').value, 'Operator X');
      w.rememberGuard('Sokha'); w.resetManForm(); w.resetIssueForm(); w.CHECK = []; w.loadPatrolCheckForm();
      assert.equal(d.getElementById('nGuard').value, 'Sokha'); assert.equal(d.getElementById('iBy').value, 'Sokha'); assert.equal(d.getElementById('pcGuard').value, 'Sokha');
      pass('patrol: guard fields default to last used name, else SEC.getCfg().operator');

      /* 空白巡邏點下拉顯示引導文字（三語） */
      const saveChip = w.CHIP; w.CHIP = {};
      for (const l of ['zh', 'en', 'km']) {
        SEC.setLang(l); w.fillLocs();
        const o = d.getElementById('nLoc').options[0];
        assert(o.disabled && o.value === '' && o.textContent.length > 20, 'guidance option first');
        w.resetManForm(); assert.equal(d.getElementById('nLoc').selectedIndex, 0, 'guidance selected on a fresh form');
        if (l !== 'zh') assert(!cjkIn([...d.getElementById('nLoc').options].map(x => x.textContent).join(' ')), 'no CJK in ' + l + ' location options');
        if (l === 'km') assert(KM.test(o.textContent));
      }
      w.CHIP = saveChip; SEC.setLang('zh'); w.rebuild();
      pass('patrol: empty checkpoint dropdown shows trilingual guidance, suggested names shown without Chinese in en/km');

      /* #18 編輯狀態：切換分頁／取消即清除；不會覆蓋舊紀錄 */
      w.MAN = [{ id:'A1', date:'2026-09-01', time:'22:00', shift:'N', guard:'Guard A', location:'Gate', status:'issue', note:'orig', photos:[] }];
      w.renderAll();
      w.editMan('A1');
      assert.equal(w.MAN_EDIT_ID, 'A1'); assert.notEqual(d.getElementById('manEditBanner').style.display, 'none');
      assert(/Guard A/.test(d.getElementById('manEditText').textContent));
      d.querySelector('#tabs .tab[data-p="iss"]').click();
      assert.equal(w.MAN_EDIT_ID, '', 'tab switch clears edit state'); assert.equal(d.getElementById('manEditBanner').style.display, 'none');
      d.querySelector('#tabs .tab[data-p="new"]').click();
      d.getElementById('nGuard').value = 'Guard B'; d.getElementById('nNote').value = 'new one';
      d.getElementById('nLoc').value = d.getElementById('nLoc').options[0].value;
      w.saveNew();
      assert.equal(w.MAN.length, 2, 'save after tab switch creates a NEW record');
      assert.equal(w.MAN.find(r => r.id === 'A1').note, 'orig', 'old record not overwritten');
      w.editMan('A1'); w.cancelManEdit(); assert.equal(w.MAN_EDIT_ID, ''); assert.equal(d.getElementById('nNote').value, '');
      w.editMan('A1'); d.querySelector('#tabs .tab[data-p="new"]').click(); assert.equal(w.MAN_EDIT_ID, '', 're-clicking 線上登錄 = new entry');
      w.editMan('A1'); d.getElementById('nNote').value = 'edited'; w.saveNew();
      assert.equal(w.MAN.length, 2); assert.equal(w.MAN.find(r => r.id === 'A1').note, 'edited'); assert.equal(w.MAN_EDIT_ID, '');
      pass('patrol #18: 編輯中 banner + 取消編輯; tab switch / new / cancel clear MAN_EDIT_ID; saves never overwrite the old record');

      /* 連點：同一顆儲存鈕快速點兩下只存一筆 */
      const n0 = w.MAN.length;
      d.getElementById('nGuard').value = 'Guard C'; d.getElementById('nTime').value = '10:11';
      const btn = wire(w, d.getElementById('nSaveBtn')); btn.click(); btn.click();
      assert.equal(w.MAN.length, n0 + 1, 'double-click saves once');
      const c0 = w.CHECK.length;
      d.getElementById('pcGuard').value = 'Guard C'; w.PC_KEYS.forEach(k => w.setPcFormValue(k, 'ok'));
      wire(w, d.getElementById('pcSaveBtn')).click(); d.getElementById('pcSaveBtn').click();
      assert.equal(w.CHECK.length, c0 + 1);
      pass('patrol: double-click guards on 巡邏確認 / 人工登錄 save');

      /* 刪除需確認 */
      let asked = 0; w.confirm = () => { asked++; return false; };
      w.delMan('A1'); assert.equal(asked, 1); assert(w.MAN.some(r => r.id === 'A1'), 'cancelled delete keeps record');
      w.confirm = () => true;
      pass('patrol: deletions ask for confirmation');

      /* 巡更棒匯入：cellDates:false 序號、同檔重匯不重複、舊版差 4 秒也不重複 */
      w.SCAN = []; w.MAN = []; w.CHECK = [];
      const base = [new w.Date(2026, 8, 1, 8, 30, 15), new w.Date(2026, 8, 1, 8, 34, 2), new w.Date(2026, 8, 1, 23, 59, 58), new w.Date(2026, 8, 2, 0, 5, 0)];
      const chips = ['0F004EBEFC', '3A0073B8C6', '3300A5D392', '3300A5CD4C'];
      const aoa = [['巡检时间', '巡检器', '人员', '巡检点', '事件', '编号'], ['Patrol Time', 'ReaderNum', 'Person', 'Checkpoint', 'Event', 'Chip ID']]
        .concat(base.map((dt, i) => [dt, 'R1', 'Guard A', '未设置', i > 1 ? 'Night Shift' : 'Day Shift', chips[i]]));
      const sheets = xlsxRows(w, aoa, 'Month');
      assert.equal(typeof sheets[0].rows[2][0], 'number', 'date cells arrive as Excel serial numbers');
      w.SEC.pickExcel = cb => cb(JSON.parse(JSON.stringify(sheets)));
      w.impWand();
      const ts = w.SCAN.map(s => s.t).sort();
      const fmt = dt => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes()) + ':' + pad(dt.getSeconds());
      assert.deepEqual(ts, base.map(fmt).sort(), 'serials → exact local date/time incl. seconds');
      w.impWand(); assert.equal(w.SCAN.length, 4, 're-import of the same file adds nothing');
      /* 模擬舊版 cellDates:true 匯入（差 4 秒）後再用新版匯入同一檔 */
      w.SCAN = base.map((dt, i) => ({ t:fmt(new w.Date(dt.getTime() - 4000)), g:'Guard A', c:chips[i], e:'D', r:'R1' }));
      w.impWand(); assert.equal(w.SCAN.length, 4, 'old (4 s off) + new import → no duplicates (minute precision)');
      /* 雲端合併後若同時有兩個版本，開頁／下載去重會收斂成一筆並寫刪除墓碑 */
      w.SCAN = w.SCAN.concat(base.map((dt, i) => ({ t:fmt(dt), g:'Guard A', c:chips[i], e:'D', r:'R1' })));
      assert.equal(w.patrolScanDedupe(), 4); assert.equal(w.SCAN.length, 4);
      w.buildRounds(); assert(w.ROUNDS.length >= 1);
      /* 兩位不同巡邏員同一分鐘打同一點 → 各自保留；空白人員（整月表）與有人員（每日表）→ 視為同一筆 */
      const keep = w.SCAN.slice();
      w.SCAN = [{ t:'2026-09-09 01:00:05', g:'Guard A', c:chips[0] }, { t:'2026-09-09 01:00:20', g:'Guard B', c:chips[0] }, { t:'2026-09-09 02:00:00', g:'', c:chips[1] }, { t:'2026-09-09 02:00:03', g:'Guard A', c:chips[1] }];
      assert.equal(w.patrolScanDedupe(), 1); assert.equal(JSON.stringify(w.SCAN.map(x => x.g)), JSON.stringify(['Guard A', 'Guard B', '']));
      w.SCAN = keep;
      /* 一般巡邏表：日期序號 + 時間小數 */
      const gen = xlsxRows(w, [['日期', '時間', '巡邏員', '地點', '狀態'], [new w.Date(2026, 8, 3), 0.3541666667, 'Guard Z', 'Gate', 'OK'], [new w.Date(2026, 8, 3), 46268.8125, 'Guard Z', 'Yard', 'issue']]);
      w.SEC.pickExcel = cb => cb(gen); w.impGeneric();
      const gz = w.MAN.filter(r => r.guard === 'Guard Z').map(r => r.date + ' ' + r.time).sort();
      assert.deepEqual(gz, ['2026-09-03 08:30', '2026-09-03 19:30']);
      assert.equal(w.wandTime(46266.3541666667), '2026-09-01 08:30:00');
      pass('patrol: wand/generic import with cellDates:false serials & fractions; same file re-import and old 4-second-off records never duplicate');

      /* 清空／還原：批次 API，不逐筆 */
      const calls = { many:0, one:0, clear:0, clearMany:0 };
      const origMany = SEC.markDeletedMany, origOne = SEC.markDeleted, origClear = SEC.clearDeleted;
      SEC.markDeletedMany = (tool, rows) => { calls.many++; };
      SEC.markDeleted = () => { calls.one++; };
      SEC.clearDeleted = () => { calls.clear++; };
      w.clearScans(); assert.equal(calls.many, 1); assert.equal(calls.one, 0); assert.equal(w.SCAN.length, 0);
      w.SCAN = base.map((dt, i) => ({ t:fmt(dt), g:'Guard A', c:chips[i], e:'D', r:'R1' }));
      w.MAN = [{ id:'M1', date:'2026-09-01', time:'01:00', guard:'G', location:'L', status:'ok' }];
      calls.many = 0; w.clearAll(); assert.equal(calls.many, 1, 'clear all = one batch call'); assert.equal(calls.one, 0);
      SEC.getDeleted = () => [];
      SEC.restoreJson = cb => cb({ scan:base.map((dt, i) => ({ t:fmt(dt), g:'Guard A', c:chips[i] })), manual:[{ id:'M2', date:'2026-09-02', time:'02:00', guard:'G', location:'L' }], confirmations:[], chip:{} });
      w.restore(); assert.equal(calls.clear, 0, 'restore with no tombstones touches nothing per row'); assert.equal(w.SCAN.length, 4);
      SEC.markDeletedMany = origMany; SEC.markDeleted = origOne; SEC.clearDeleted = origClear;
      pass('patrol: clear punches / clear all / restore use batch tombstone calls (no per-row loops)');

      /* 摘要、匯出、介面：en/km 無中文；km 用正確用字；語言切換重畫 */
      w.CHIP = {}; w.CP_BASELINE_APPLIED = ''; w.applyAttachmentCheckpointBaseline(); /* 12 個雙語建議名稱 */
      const td = today;
      w.SCAN = w.ATTACHMENT_LATEST_CP.slice(0, 11).map((c, i) => ({ t:td + ' 22:' + pad(i * 2) + ':00', g:'Guard A', c:c, e:'N', r:'R1' }));
      w.MAN = [{ id:'X1', date:td, time:'22:00', shift:'N', guard:'Guard A', location:w.SUGGEST[0], status:'issue', note:'Door open', photos:[] }];
      w.CHECK = [{ id:td + '|all', date:td, shift:'all', guard:'Guard A', checks:{ doors:'issue', windows:'ok', water:'ok', electric:'ok', lights:'', fireway:'ok' }, note:'Door', photos:[], photoNotes:[] }];
      w.PER = new SEC.Period('day', new w.Date()); w.rebuild();
      for (const lang of ['en', 'km']) {
        for (const det of [false, true]) for (const ptype of ['day', 'month']) {
          const st = { ptype, period:ptype === 'day' ? td : td.slice(0, 7), scope:'all', lang, includeDetails:det };
          const txt = w.patrolSummaryPages(st).join('\n') + '\n' + w.patrolNightSummaryPages(st).join('\n');
          assert(!cjkIn(txt), 'patrol telegram ' + lang + ' has Chinese: ' + (txt.match(/.{0,30}[㐀-鿿].{0,10}/) || [''])[0]);
          if (lang === 'km') assert(KM.test(txt));
        }
        SEC.setLang(lang); w.renderAll();
        const leaks = cjkTexts(w); assert.deepEqual(leaks, [], lang + ' UI leaks');
        const ex = captureExport(w); w.expRounds(); assert.deepEqual(exportCjk(ex[0]), [], lang + ' Excel leaks');
        const opts = []; w.SEC.tgOpen = o => { opts.push(o); return { close() {} }; };
        w.openPatrolTelegram(); assert(opts[0].scopeOptions.every(x => !cjkIn(x.label)));
        const saves = []; w.SEC.tgSummary = (txt) => { saves.push(txt); return Promise.resolve(true); };
        await sleep(650); /* 等待前面真實點擊的 600ms 連點鎖 */
        w.editMan('X1'); await w.saveNew(true); assert(saves.length && !cjkIn(saves[0].replace(/Front Gate/, '')), 'manual notify text single-language');
      }
      SEC.setLang('km');
      assert(/កាលបរិច្ឆេទ/.test(d.getElementById('p-check').textContent) && !/>កាល</.test(d.body.innerHTML), 'km date = កាលបរិច្ឆេទ');
      w.PER.setMode('month'); w.renderAll(); assert(/រយៈពេល/.test(d.getElementById('roundHead').textContent), 'km period = រយៈពេល');
      SEC.setLang('en'); assert(/Period/.test(d.getElementById('roundHead').textContent), 'header re-rendered on language change');
      const zhSt = { ptype:'day', period:td, scope:'all', lang:'zh', includeDetails:true };
      assert(cjkIn(w.patrolSummaryPages(zhSt)[0]), 'zh summary still Chinese');
      pass('patrol: Telegram summary/night pages, UI, placeholders, options, Excel headers+cells, notify text → single language in en/km; km uses កាលបរិច្ឆេទ / រយៈពេល; re-render on language change');
    } finally { P.dom.window.close(); }
  }

  /* ═════════ CCTV ═════════ */
  {
    const P = await load('ac_sec_cctv_v2.html'), w = P.w, d = w.document, SEC = w.SEC;
    await sleep(250);
    try {
      assert.deepEqual(P.errors, []);
      /* 空白狀態直接有「產生攝影機編號」 */
      w.DB = []; w.LOG = []; SEC.setLang('en'); w.renderAll();
      const gen = d.querySelector('#camGrid .cctv-empty button[onclick="genCams()"]');
      assert(gen, 'empty state contains the generate button'); assert(!cjkIn(d.getElementById('camGrid').textContent));
      wire(w, gen).click(); assert.equal(w.DB.length, 41, 'generates 41 official camera codes');
      pass('cctv: empty state shows the 🏭 generate-camera-IDs button directly (works, en text)');

      /* #23：補登舊日期不讓 lastCheck／狀態倒退 */
      const cam = w.DB[0]; cam.lastCheck = '2026-09-20'; cam.status = 'ok';
      d.getElementById('cDate').value = '2026-09-10'; d.getElementById('cBy').value = 'Tester'; d.getElementById('cNote').value = 'late entry';
      w.TODAY = {}; w.TODAY[cam.id] = 'off'; w.saveDay();
      assert.equal(cam.lastCheck, '2026-09-20', 'back-dated inspection keeps newer lastCheck');
      assert.equal(cam.status, 'ok', 'back-dated inspection keeps current status');
      assert(w.LOG.some(l => l.date === '2026-09-10' && l.st[cam.id] === 'off'), 'history still recorded');
      d.getElementById('cDate').value = '2026-09-25'; w.TODAY = {}; w.TODAY[cam.id] = 'fault'; w.saveDay();
      assert.equal(cam.lastCheck, '2026-09-25'); assert.equal(cam.status, 'fault');
      d.getElementById('cDate').value = '2026-09-10'; w.loadDay(); w.TODAY[cam.id] = 'blur'; w.saveDay();
      assert.equal(cam.lastCheck, '2026-09-25', 'editing an old inspection never moves lastCheck backwards'); assert.equal(cam.status, 'fault');
      pass('cctv #23: back-dated / edited inspection never moves camera lastCheck (or status) backwards');

      /* 連點 */
      const logs0 = JSON.stringify(w.LOG.map(l => l.date));
      let saves = 0; const origSave = w.saveDayNow; w.saveDayNow = function () { saves++; return origSave.apply(this, arguments); };
      wire(w, d.getElementById('cSaveBtn')).click(); d.getElementById('cSaveBtn').click(); w.saveDayNow = origSave;
      assert.equal(saves, 1, 'second click ignored');
      assert.equal(JSON.stringify(w.LOG.map(l => l.date)), logs0);
      pass('cctv: double-click on Save stores one record per day');

      /* 三語：km 全面、表格 {zh,en,km}、單一語言輸出 */
      assert(w.ZONES.every(z => z.km && KM.test(z.km)) && Object.keys(w.STAT).every(k => KM.test(w.STAT[k].km)) && Object.keys(w.CCTV_FACTORIES).every(k => KM.test(w.CCTV_FACTORIES[k].km)), 'zone/status/factory tables have km');
      assert.equal(w.cctvText('km', '正常', 'Normal', 'ធម្មតា'), 'ធម្មតា'); assert.equal(w.cctvText('km', '正常', 'Normal'), 'Normal'); assert.equal(w.cctvBi('en', '中', 'EN', 'KM'), 'EN');
      const src = fs.readFileSync(path.join(__dirname, '..', 'ac_sec_cctv_v2.html'), 'utf8');
      const calls = src.match(/cctvText\([^)]*\)/g).filter(c => !/function cctvText/.test(c));
      const noKm = calls.filter(c => (c.match(/'[^']*'/g) || []).length === 2 && CJK.test(c));
      assert.deepEqual(noKm, [], 'every cctvText call with Chinese literal also has km');
      w.DB.forEach((c, i) => { c.name = 'Cam ' + i; });
      w.LOG.forEach(l => { l.by = 'Tester'; l.note = 'n'; });
      w.PER = new SEC.Period('month', new w.Date(2026, 8, 15));
      for (const lang of ['en', 'km']) {
        SEC.setLang(lang); w.renderAll();
        d.querySelectorAll('#tabs .tab').forEach(b => b.click());
        w.openEdit(w.DB[0].id);
        assert.deepEqual(cjkTexts(w), [], 'cctv ' + lang + ' UI');
        for (const det of [false, true]) for (const [ptype, period] of [['day', '2026-09-10'], ['month', '2026-09']]) {
          for (const scope of ['all', 'factory:a', 'zone:gate']) {
            const txt = w.cctvSummaryPages({ ptype, period, scope, lang, includeDetails:det }).join('\n');
            assert(!cjkIn(txt), 'cctv summary ' + lang);
          }
        }
        const ex = captureExport(w); w.expExcel(); w.expLog(); assert.deepEqual(exportCjk([].concat(...ex)), [], 'cctv ' + lang + ' Excel');
        assert(w.cctvScopeOptions().every(o => !cjkIn(o.label)));
        SEC.closeModal('mEdit');
      }
      SEC.setLang('km'); w.PER.setMode('day'); w.PER.at = new w.Date(2026, 8, 10); w.renderAll();
      assert(/កាលបរិច្ឆេទ/.test(d.getElementById('logHead').textContent), 'log header in km');
      assert(d.getElementById('faultHead') && d.getElementById('logHead') && d.getElementById('faultHead') !== d.getElementById('logHead'));
      pass('cctv: cctvText/cctvBi single-language with km; zone/status/factory/type tables {zh,en,km}; UI, modal, Telegram summaries and Excel headers+cells without Chinese in en/km');

      /* 刪除確認 */
      let asked = 0; w.confirm = () => { asked++; return false; };
      w.deleteCctvLog('2026-09-10'); w.EDIT_ID = w.DB[0].id; w.delCam(); assert.equal(asked, 2); assert.equal(w.DB.length, 41);
      w.confirm = () => true;
      pass('cctv: deletions confirm first');
    } finally { P.dom.window.close(); }
  }

  /* ═════════ 出勤 ═════════ */
  {
    const P = await load('ac_sec_attendance_v2.html'), w = P.w, d = w.document, SEC = w.SEC;
    await sleep(300);
    try {
      assert.deepEqual(P.errors, []);
      for (const lang of ['zh', 'en', 'km']) {
        SEC.setLang(lang);
        const pal = [...d.querySelectorAll('#palette .pb')].map(b => b.textContent);
        assert.equal(pal.length, 7);
        if (lang !== 'zh') assert(!cjkIn(pal.join(' ')), 'palette ' + lang);
        if (lang === 'km') assert(pal.slice(0, 6).every(x => KM.test(x)), 'W/O/R/L/A/H labels in Khmer');
        if (lang === 'en') assert.deepEqual(pal.slice(0, 6), ['W Work', 'O Overtime', 'R Rest', 'L Leave', 'A Absent', 'H Holiday']);
      }
      pass('attendance: brush codes W/O/R/L/A/H labelled in zh/en/km');

      /* 空白狀態不被表格 nowrap 切掉 */
      w.ALL_STAFF = []; w.ATT = {}; SEC.setLang('en'); w.renderAll();
      const empty = d.getElementById('gridEmpty');
      assert.notEqual(empty.style.display, 'none'); assert.equal(d.getElementById('gridWrap').style.display, 'none');
      assert(!empty.closest('table'), 'empty state is outside the nowrap table');
      assert(empty.querySelector('button[onclick="impExcel()"]') && empty.querySelector('button[onclick="addOnePerson()"]'));
      pass('attendance: empty state rendered outside the grid table with action buttons');

      /* 按鈕列：主要「儲存」外露，其餘收進 ⋯ 更多 */
      const bar = d.querySelector('#p-grid .card h3 .sp');
      const visible = [...bar.children].filter(el => el.tagName === 'BUTTON');
      assert.equal(visible.length, 1); assert.equal(visible[0].id, 'saveGridBtn');
      const menu = d.querySelectorAll('#attMore .menu button'); assert.equal(menu.length, 5);
      pass('attendance: only primary Save stays on the bar; secondary actions in "⋯ More"');

      /* 清除單格不問；清空整月要確認（三語） */
      w.ALL_STAFF = [{ id:'S1', empId:'5001', name:'Guard One', status:'active', shift:'A', post:'Gate' }];
      const m = w.ym(); w.ATT[m] = { '5001':{ '01':'W', '02':'A' } }; w.renderAll();
      const asked = []; w.confirm = msg => { asked.push(msg); return true; };
      w.setBrush(''); w.paint(d.querySelector('#gridT .cell[data-d="01"]'));
      assert.equal(asked.length, 0, 'clearing a cell does not ask');
      assert.equal(w.ATT[m]['5001']['01'], undefined);
      w.clearMonth(); assert.equal(asked.length, 1); assert(!cjkIn(asked[0]) && /Clear ALL/.test(asked[0]));
      SEC.setLang('km'); w.ATT[m] = { '5001':{ '02':'A' } }; w.clearMonth(); assert(KM.test(asked[1]) && !cjkIn(asked[1]));
      pass('attendance: clearing a cell asks nothing; clearing a whole month confirms (en/km without Chinese)');

      /* 匯入：Excel 時間小數 + 大量資料（id→record 索引，不是 O(n²)），重匯不重複 */
      SEC.setLang('en'); w.PER.at = new w.Date(2026, 8, 1);
      const people = 150, head = ['No', 'ID', 'NAME'].concat(Array.from({ length:30 }, (_, i) => i + 1));
      const aoa = [['VRT Security attendance September 2026'], head];
      for (let i = 0; i < people; i++) aoa.push([i + 1, 7000 + i, 'Guard ' + i].concat(Array.from({ length:30 }, (_, k) => k % 7 === 6 ? 'R' : (i % 2 ? 0.2916666667 : '07:00 AM 19:00 PM'))));
      const sheets = xlsxRows(w, aoa, 'September 2026');
      sheets[0].fileName = 'Day Shift Attendance.xlsx';
      w.SEC.pickExcel = cb => cb(JSON.parse(JSON.stringify(sheets)));
      let t0 = Date.now(); await w.impExcel(); await sleep(50);
      for (let k = 0; k < 200 && w.ATT_LOG.length < people * 30; k++) await sleep(50);
      const first = Date.now() - t0;
      assert.equal(w.ATT_LOG.length, people * 30, 'all raw punches imported');
      const odd = w.ATT_LOG.find(r => r.empId === '7001' && r.date === '2026-09-01');
      assert.equal(odd.inTime, '07:00', 'numeric Excel time fraction → HH:MM');
      const even = w.ATT_LOG.find(r => r.empId === '7000' && r.date === '2026-09-01');
      assert.equal(even.inTime, '07:00'); assert.equal(even.outTime, '19:00');
      t0 = Date.now(); await w.impExcel(); await sleep(400);
      assert.equal(w.ATT_LOG.length, people * 30, 're-import does not duplicate');
      const src = fs.readFileSync(path.join(__dirname, '..', 'ac_sec_attendance_v2.html'), 'utf8');
      assert(/var old = rawById\[rec\.id\]/.test(src) && !/ATT_LOG\.filter\(function \(x\) \{ return x\.id === rec\.id; \}\)/.test(src), 'import uses an id→record map');
      assert(first < 20000, 'import of ' + people * 30 + ' punches finished in ' + first + ' ms');
      pass('attendance: import ' + people * 30 + ' punches in ' + first + ' ms via id→record map; Excel time fractions → HH:MM; re-import no duplicates');

      /* Telegram 與匯出單一語言 */
      w.PER.at = new w.Date(2026, 8, 1); w.renderAll();
      for (const lang of ['en', 'km']) {
        SEC.setLang(lang); w.renderAll();
        for (const det of [false, true]) {
          const txt = w.attendanceSummaryPages({ ptype:'month', period:'2026-09', lang, includeDetails:det }).join('\n');
          assert(!cjkIn(txt), 'attendance summary ' + lang);
        }
        const sent = []; w.SEC.tgSummary = txt => { sent.push(txt); return Promise.resolve(true); };
        await w.pushFee(); assert(sent.length === 1 && !cjkIn(sent[0]), 'fee recon text ' + lang);
        const ex = captureExport(w); w.expSum(); w.expFee(); w.expGrid(); w.expRaw();
        assert.deepEqual(exportCjk([].concat(...ex)), [], 'attendance ' + lang + ' Excel');
        d.querySelectorAll('#tabs .tab').forEach(b => b.click());
        assert.deepEqual(cjkTexts(w), [], 'attendance ' + lang + ' UI');
      }
      pass('attendance: Telegram summary + fee reconciliation, Excel headers+cells and all tabs single-language in en/km');
    } finally { P.dom.window.close(); }
  }

  await chromiumChecks();
  console.log('ALL fix-m3 checks passed (' + passed + ')');
})().catch(e => { console.error(e); process.exitCode = 1; });

/* ═════════ 真 Chromium 390x844 ═════════ */
async function chromiumChecks() {
  let chromium = null;
  try { chromium = require('playwright').chromium; } catch (e) { try { chromium = require('playwright-core').chromium; } catch (_) {} }
  if (!chromium) { console.log('SKIP: Chromium part (playwright not installed)'); return; }
  const exe = process.env.SEC_TEST_CHROMIUM || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  const root = path.join(__dirname, '..');
  /* 真 .xlsx（SheetJS 產生，含真正的日期時間儲存格）供檔案選擇器上傳 */
  const XLSX = require(path.join(root, 'shared', 'xlsx.full.min.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-'));
  const wandFile = path.join(tmp, 'wand.xlsx');
  {
    const wb = XLSX.utils.book_new(), rows = [['巡检时间', '巡检器', '人员', '巡检点', '事件', '编号'], ['Patrol Time', 'ReaderNum', 'Person', 'Checkpoint', 'Event', 'Chip ID']];
    ['0F004EBEFC', '3A0073B8C6', '3300A5D392'].forEach((c, i) => rows.push([new Date(2026, 8, 5, 22, 10 + i * 3, 7), 'R1', 'Guard Web', '未设置', 'Night Shift', c]));
    XLSX.utils.book_append_sheet(wb, sheetFromAoa(XLSX, rows), 'Sheet1');
    fs.writeFileSync(wandFile, Buffer.from(XLSX.write(wb, { type:'array', bookType:'xlsx' })));
  }
  const browser = await chromium.launch({ executablePath:exe, args:['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], headless:true });
  const SNAP = () => {
    const out = [], CJK = /[㐀-鿿豈-﫿]/;
    const vis = el => { if (!el || !el.getClientRects().length) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) { const el = n.parentElement; if (!el || /SCRIPT|STYLE/.test(el.tagName) || el.closest('.lang-sw')) continue; const s = n.nodeValue.trim(); if (!s || !CJK.test(s)) continue;
      if (el.tagName === 'OPTION') { const sel = el.closest('select'); if (sel && vis(sel)) out.push('option:' + s); continue; } if (vis(el)) out.push(s.slice(0, 80)); }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el => { if (!vis(el)) return; ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v && CJK.test(v)) out.push('@' + a + ':' + v); }); });
    if (CJK.test(document.title)) out.push('title:' + document.title);
    return out;
  };
  const OWN = /sec-smart-sync|智慧同步|自動同步|已檢查|雲端|未連線|Cloud/;   /* 共用元件 toast 不屬本組檔案 */
  try {
    for (const lang of ['zh', 'en', 'km']) {
      const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
      await ctx.addInitScript(l => { try { localStorage.setItem('ac_sec_config', JSON.stringify({ lang:l, operator:'Tester', route:'review' })); } catch (e) {} window.__dlg = []; window.confirm = m => { window.__dlg.push(String(m)); return true; }; window.alert = m => window.__dlg.push(String(m)); window.prompt = () => null; }, lang);
      await ctx.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.hostname === 'offline.test') { const p = path.join(root, decodeURIComponent(u.pathname)); if (fs.existsSync(p) && fs.statSync(p).isFile()) return route.fulfill({ status:200, contentType:p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream', body:fs.readFileSync(p) }); return route.fulfill({ status:404, body:'' }); }
        if (/cdnjs|jsdelivr|unpkg/.test(u.hostname)) return route.fulfill({ status:200, contentType:'application/javascript', body:'window.Chart=class{constructor(){this.data={datasets:[]};this.options={}}destroy(){}update(){}resize(){}};window.Chart.register=function(){};' });
        return route.abort();
      });
      for (const pg of ['ac_sec_patrol_v2.html', 'ac_sec_cctv_v2.html', 'ac_sec_attendance_v2.html']) {
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto('https://offline.test/' + pg); await page.waitForTimeout(900);
        if (pg === 'ac_sec_attendance_v2.html') {
          /* 空白狀態完整顯示、不被切掉 */
          const clip = await page.evaluate(() => { const e = document.getElementById('gridEmpty'); return e && getComputedStyle(e).display !== 'none' ? { sw:e.scrollWidth, cw:e.clientWidth } : null; });
          if (clip) assert(clip.sw <= clip.cw + 1, pg + ' empty state clipped');
          await page.click('#attMore summary'); await page.waitForTimeout(150);
          assert(await page.isVisible('#attMore .menu'));
          if (lang !== 'zh') assert.deepEqual((await page.evaluate(SNAP)).filter(x => !OWN.test(x)), [], pg + ' ' + lang + ' more-menu');
          await page.click('#attMore summary');
          await page.evaluate(() => { ALL_STAFF = [{ id:'S1', empId:'5001', name:'Guard One', status:'active', shift:'A', post:'Gate 1' }]; var m = ym(); ATT[m] = { '5001':{ '01':'W', '02':'O', '03':'A' } }; renderAll(); });
        }
        if (pg === 'ac_sec_cctv_v2.html') {
          assert(await page.isVisible('#camGrid .cctv-empty button'), 'cctv empty state button visible');
          await page.click('#camGrid .cctv-empty button'); await page.waitForTimeout(300);
          assert.equal(await page.evaluate(() => DB.length), 41);
          const kpi = await page.evaluate(() => { const g = document.getElementById('cctvKpis'); return { h:g.getBoundingClientRect().height, disp:getComputedStyle(g).display }; });
          assert(kpi.disp === 'flex' && kpi.h < 70, 'mobile KPI cards compact into one row (h=' + kpi.h + ')');
        }
        if (pg === 'ac_sec_patrol_v2.html') {
          const tb = await page.evaluate(() => { const t = document.getElementById('tabs'), r = [...t.querySelectorAll('.tab')].slice(0, 3).map(b => b.getBoundingClientRect()); return { sw:t.scrollWidth, cw:t.clientWidth, first3:r.every(x => x.right <= innerWidth + 1), fade:getComputedStyle(document.getElementById('tabsWrap'), '::after').content }; });
          assert(tb.first3, 'first 3 guard tabs visible without scrolling'); assert(tb.sw > tb.cw && /›/.test(tb.fade), 'tab bar visibly scrollable (fade + ›)');
          assert.equal(await page.inputValue('#pcDate'), await page.evaluate(() => SEC.ymd()));
          /* 真檔案匯入（檔案選擇器 → SEC.readWorkbook） */
          await page.click('#tabs .tab[data-p="data"]');
          const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#p-data button[onclick="impWand()"]')]);
          await fc.setFiles(wandFile); await page.waitForTimeout(700);
          const scans = await page.evaluate(() => SCAN.map(s => s.t).sort());
          const want = ['2026-09-05 22:10:07', '2026-09-05 22:13:07', '2026-09-05 22:16:07'];
          assert.equal(scans.length, 3);
          /* 共用 readWorkbook 改為 cellDates:false 後為精確秒數；舊設定（Date 物件）可能差數秒，分鐘精度必須一致 */
          scans.forEach((s, i) => assert(Math.abs(Date.parse(s.replace(' ', 'T')) - Date.parse(want[i].replace(' ', 'T'))) <= 59000, s + ' vs ' + want[i]));
          const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#p-data button[onclick="impWand()"]')]);
          await fc2.setFiles(wandFile); await page.waitForTimeout(700);
          assert.equal(await page.evaluate(() => SCAN.length), 3, 're-import via real file: no duplicates');
          /* 真連點：人工登錄 */
          await page.click('#tabs .tab[data-p="new"]');
          await page.fill('#nGuard', 'Dbl Click'); await page.fill('#nTime', '11:11');
          await page.evaluate(() => { var s = document.getElementById('nLoc'); var o = [...s.options].find(x => !x.disabled && x.value !== '__other'); s.value = o.value; });
          await page.dblclick('#nSaveBtn'); await page.waitForTimeout(300);
          assert.equal(await page.evaluate(() => MAN.filter(r => r.guard === 'Dbl Click').length), 1, 'real double-click saves once');
          /* 編輯 → 切換分頁 → 新增 */
          await page.evaluate(() => { var r = MAN.filter(x => x.guard === 'Dbl Click')[0]; editMan(r.id); });
          assert(await page.isVisible('#manEditBanner'));
          await page.click('#tabs .tab[data-p="check"]'); await page.click('#tabs .tab[data-p="new"]');
          assert(!(await page.isVisible('#manEditBanner')));
          assert.equal(await page.evaluate(() => MAN_EDIT_ID), '');
        }
        /* 所有分頁、彈窗：no overflow、en/km 無中文 */
        const tabs = await page.$$eval('#tabs .tab', els => els.map(e => e.dataset.p));
        for (const t of tabs) {
          await page.click('#tabs .tab[data-p="' + t + '"]'); await page.waitForTimeout(120);
          const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert(ov <= 1, pg + ' ' + lang + ' tab ' + t + ' horizontal overflow ' + ov);
          if (lang !== 'zh') { const leaks = (await page.evaluate(SNAP)).filter(x => !OWN.test(x)); assert.deepEqual(leaks, [], pg + ' ' + lang + ' tab ' + t); }
        }
        /* Telegram 預覽（依介面語言預設 en/km 時切換） */
        await page.evaluate(() => { var b = document.getElementById('btnTg'); if (b) b.click(); });
        await page.waitForTimeout(300);
        if (await page.$('#tgPreview')) {
          for (const tl of ['en', 'km']) {
            const txt = await page.evaluate(l => { var s = document.querySelector('#tgLang'); s.value = l; s.dispatchEvent(new Event('change')); return document.querySelector('#tgPreview').innerText; }, tl);
            assert(!/[㐀-鿿]/.test(txt), pg + ' telegram preview ' + tl + ' has Chinese');
          }
          await page.evaluate(() => document.querySelectorAll('.mask.on').forEach(m => m.remove()));
        }
        if (pg === 'ac_sec_cctv_v2.html') {
          await page.evaluate(() => openEdit(DB[0].id)); await page.waitForTimeout(150);
          if (lang !== 'zh') assert.deepEqual((await page.evaluate(SNAP)).filter(x => !OWN.test(x)), [], 'cctv edit modal ' + lang);
          const dlg = await page.evaluate(() => { window.__dlg = []; delCam(); return window.__dlg.slice(); });
          assert.equal(dlg.length, 1, 'delete asks'); if (lang !== 'zh') assert(!/[㐀-鿿]/.test(dlg[0]));
        }
        if (lang !== 'zh') { const dl = await page.evaluate(() => window.__dlg.filter(m => /[㐀-鿿]/.test(m) && !/sec-smart|雲端/.test(m))); assert.deepEqual(dl, [], pg + ' ' + lang + ' dialogs'); }
        assert.deepEqual(errors, [], pg + ' ' + lang + ' page errors');
        await page.close();
      }
      await ctx.close();
      pass('Chromium 390x844 ' + lang + ': patrol/cctv/attendance all tabs + modals clickable, no overflow, no page errors' + (lang === 'zh' ? '' : ', no Chinese (UI, dialogs, Telegram preview)') + '; real .xlsx upload twice (no dupes), real double-click, edit-state reset, compact CCTV KPIs, scrollable patrol tabs');
    }
  } finally { await browser.close(); }
}
