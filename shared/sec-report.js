/* AC Security 參考報告（Word）（2026-10-22）
 * 每一頁「⋯ → 📝 產生報告」：選 週／月／年、期間、語言（中文＋English 或 English＋ខ្មែរ），
 * 用該頁同一套 Telegram 摘要邏輯整理成管理摘要，加上期間比較、近期趨勢、明細表、資料依據與簽名欄，
 * 產生仿 sewing 週報版面的 .docx 供參考，不會發到任何地方。
 * 頁面用 SEC.registerReport(tool, spec) 登記（見下方 spec 說明）。 */
(function (g) {
  'use strict';
  var SEC = g.SEC; if (!SEC || SEC.Report) return;
  var L = SEC.L, esc = SEC.esc, REPORTS = {};
  var TYPE_NAME = { week:['週報', 'Weekly Report', 'របាយការណ៍ប្រចាំសប្តាហ៍'], month:['月報', 'Monthly Report', 'របាយការណ៍ប្រចាំខែ'], year:['年報', 'Annual Report', 'របាយការណ៍ប្រចាំឆ្នាំ'], day:['日報', 'Daily Report', 'របាយការណ៍ប្រចាំថ្ងៃ'] };
  function tx(v, lang) { if (v == null) return ''; if (typeof v === 'string') return v; if (Array.isArray(v)) return lang === 'en' ? (v[1] || v[0]) : lang === 'km' ? (v[2] || v[1] || v[0]) : v[0]; return lang === 'en' ? (v.en || v.zh || '') : lang === 'km' ? (v.km || v.en || v.zh || '') : (v.zh || v.en || ''); }
  function anchor(key, type) {
    var s = String(key || '');
    if (type === 'year' && /^\d{4}$/.test(s)) return new Date(+s, 0, 1);
    if (type === 'month' && /^\d{4}-\d{2}$/.test(s)) return new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, 1);
    return SEC.parseD(s) || new Date();
  }
  function periodOf(type, key) { return new SEC.Period(type, anchor(key, type)); }
  function prevKey(type, key) { return periodOf(type, key).shift(-1).key(); }
  function label(type, key) { return periodOf(type, key).label(); }
  function strip(h) { return SEC.TG.strip(String(h || '')).replace(/<br\s*\/?>/gi, '\n').replace(/<blockquote[^>]*>/gi, '\n').replace(/<\/blockquote>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); }
  /* Telegram 摘要 → 報告段落：去掉每頁第一行標題、📅 期間行、分隔線；進度條只留百分比 */
  function lines(pages) {
    var out = [];
    (pages || []).forEach(function (pg) {
      var ls = strip(pg).split('\n').map(function (s) { return s.replace(/[🟩🟨🟥🟧⬜⬛]+\s*/gu, '').replace(/\s+$/, ''); }).filter(function (s) { return s.trim(); });
      ls.forEach(function (s, i) {
        var t = s.trim();
        if (/^📅/.test(t) || /^[─━═\-—·•\s]+$/.test(t) || /^AC Security Platform/i.test(t)) return;
        if (i === 0 && !/^[•\-]/.test(t)) { out.push({ h:true, text:s }); return; }
        out.push(s);
      });
    });
    return out;
  }
  function num(v) { if (typeof v === 'number') return v; var m = String(v == null ? '' : v).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : null; }
  function pct(cur, prev) { var a = num(cur), b = num(prev); if (a == null || b == null) return '—'; if (!b) return a ? '+100%' : '—'; var p = Math.round((a - b) / Math.abs(b) * 100); return (p > 0 ? '+' : '') + p + '%'; }
  function scopeOpts(spec) { try { return typeof spec.scopeOptions === 'function' ? spec.scopeOptions() : spec.scopeOptions; } catch (e) { return null; } }
  function registerReport(tool, spec) { if (tool && spec && typeof spec.summary === 'function') REPORTS[String(tool)] = spec; }
  function reports() { return REPORTS; }

  /* 把頁面的摘要邏輯整理成 ACReportDoc 的 model */
  function buildModel(tool, R) {
    var spec = Object.assign({}, REPORTS[tool], { scopeOptions:scopeOpts(REPORTS[tool]) }), A = R.lang === 'en-km' ? 'en' : 'zh', B = R.lang === 'en-km' ? 'km' : 'en';
    var P = function (zh, en, km) { return [tx([zh, en, km], A), tx([zh, en, km], B)]; };
    var st = function (lang, key) { return { mode:'summary', ptype:R.ptype, period:key, lang:lang, scope:R.scope || '', includeDetails:!!R.details }; };
    var la = lines(spec.summary(st(A, R.key))), lb = lines(spec.summary(st(B, R.key)));
    var txt = function (x) { return x && x.h ? x.text : x; }, isH = function (x) { return !!(x && x.h); };
    var pairs = la.length === lb.length ? la.map(function (s, i) { var a = txt(s), b = txt(lb[i]); return isH(s) ? [a, b === a ? '' : b, 'h'] : [a, b === a ? '' : b]; })
      : la.map(function (s) { return isH(s) ? [txt(s), '', 'h'] : [txt(s), '']; }).concat(lb.map(function (s) { return isH(s) ? [txt(s), '', 'h'] : [txt(s), '']; }));
    var secs = [], notes = String(R.note || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var s1 = { title:P('一、管理摘要', '1. Executive Summary', '១. សេចក្តីសង្ខេប'), bullets:notes.map(function (n) { return [n, '', '1F3864']; }), paragraphs:pairs };
    secs.push(s1);
    /* 期間比較 */
    var prev = prevKey(R.ptype, R.key), cmpRows = [], kpiA = [], kpiP = [];
    try { kpiA = spec.kpis ? (spec.kpis(st(A, R.key)) || []) : []; kpiP = spec.kpis ? (spec.kpis(st(A, prev)) || []) : []; } catch (e) {}
    var cnt = function (key) { try { if (spec.counts) return spec.counts(st(A, key)); if (spec.rows) { var r = spec.rows(st(A, key)); return r && r.rows ? r.rows.length : null; } } catch (e) {} return null; };
    var c1 = cnt(R.key), c0 = cnt(prev);
    if (c1 != null) cmpRows.push([P('筆數', 'Records', 'កំណត់ត្រា'), String(c1), String(c0 == null ? '—' : c0), pct(c1, c0)]);
    kpiA.forEach(function (k, i) { var p = kpiP.filter(function (x) { return tx(x.label, 'en') === tx(k.label, 'en'); })[0] || kpiP[i]; var pv = p && num(p.value) != null ? p.value : null; cmpRows.push([[tx(k.label, A), tx(k.label, B)], String(k.value == null ? '—' : k.value), pv == null ? '—' : String(pv), pv == null ? '—' : pct(k.value, pv)]); });
    secs.push({ title:P('二、期間比較', '2. Period Comparison', '២. ប្រៀបធៀបរយៈពេល'), table:{ widths:[3400, 2100, 2100, 2100], head:[P('指標', 'Metric', 'សូចនាករ'), P('本期 ' + label(R.ptype, R.key), 'This period ' + label(R.ptype, R.key), 'រយៈពេលនេះ ' + label(R.ptype, R.key)), P('上期 ' + label(R.ptype, prev), 'Previous ' + label(R.ptype, prev), 'មុន ' + label(R.ptype, prev)), P('變化', 'Change', 'ប្រែប្រួល')], rows:cmpRows, rowOpts:cmpRows.map(function (_, i) { return i === 0 ? { fill:'blue', bold:true } : {}; }), empty:P('沒有可比較的數字。', 'No comparable figures.', 'គ្មានតួលេខ។') } });
    /* 近期趨勢（6 期） */
    var trend = [], k = R.key, max = 0;
    for (var i = 0; i < 6; i++) { var c = cnt(k); trend.unshift({ key:k, n:c }); if (c != null && c > max) max = c; k = prevKey(R.ptype, k); }
    if (trend.some(function (t) { return t.n != null; })) secs.push({ title:P('三、近期趨勢', '3. Recent Trend', '៣. និន្នាការថ្មីៗ'), table:{ widths:[2600, 1800, 5300], head:[P('期間', 'Period', 'រយៈពេល'), P('筆數', 'Records', 'កំណត់ត្រា'), ''], rows:trend.map(function (t) { var n = t.n == null ? 0 : t.n; return [label(R.ptype, t.key), String(t.n == null ? '—' : t.n), max ? '▇'.repeat(Math.max(0, Math.round(n / max * 24))) : '']; }), rowOpts:trend.map(function (t) { return t.key === R.key ? { fill:'blue', bold:true } : {}; }) } });
    /* 明細 */
    if (spec.rows) {
      try {
        var ra = spec.rows(st(A, R.key)), rb = spec.rows(st(B, R.key)), rows = (ra && ra.rows) || [], cap = 300;
        var head = (ra.head || []).map(function (h, i) { var hb = rb && rb.head && rb.head[i]; var a = tx(h, A), b = hb ? tx(hb, B) : tx(h, B); return [a, b === a ? '' : b]; });
        var widths = ra.widths || null;
        secs.push({ title:P('四、明細', '4. Details', '៤. លម្អិត'), table:{ widths:widths, head:head, rows:rows.slice(0, cap).map(function (r) { return r.map(function (v) { return v == null ? '' : String(v); }); }), note:rows.length > cap ? P('只列前 ' + cap + ' 筆（共 ' + rows.length + ' 筆），完整資料請匯出 Excel。', 'First ' + cap + ' of ' + rows.length + ' rows; export Excel for the full list.', cap + '/' + rows.length) : null, empty:P('本期沒有資料。', 'No records in this period.', 'គ្មានទិន្នន័យ។') } });
      } catch (e) {}
    }
    /* 資料依據 */
    var basis = [P('資料來源：AC Security 平台「' + tx(spec.title, 'zh') + '」模組，由各頁面手動登錄、Excel 匯入與雲端同步而來；本報告與 Telegram 群組摘要使用同一套統計邏輯。', 'Source: the "' + tx(spec.title, 'en') + '" module of the AC Security platform (manual entries, Excel imports and cloud sync); the same logic as the Telegram group summary.', 'ប្រភព៖ ម៉ូឌុល "' + tx(spec.title, 'km') + '" នៃវេទិកា AC Security។'),
      P('「變化」以上期為基準。本報告由系統產生，僅供內部參考，不會自動發送。', '"Change" is against the previous period. System-generated for internal reference only; never sent automatically.', 'បង្កើតដោយប្រព័ន្ធ សម្រាប់យោងផ្ទៃក្នុងតែប៉ុណ្ណោះ។')];
    (spec.notes || []).forEach(function (n) { basis.push([tx(n, A), tx(n, B)]); });
    secs.push({ title:P('五、資料依據與限制', '5. Data Basis and Limitations', '៥. មូលដ្ឋានទិន្នន័យ'), bullets:basis });
    var tn = TYPE_NAME[R.ptype] || TYPE_NAME.month, scope = null;
    if (R.scope && spec.scopeOptions) { var so = spec.scopeOptions.filter(function (x) { return x.value === R.scope; })[0]; if (so) scope = [tx(so.label, A), tx(so.label, B)]; }
    return { lang:R.lang, title:[tx(spec.title, A), tx(spec.title, B)], typeName:[tx(tn, A), tx(tn, B)], periodPrefix:tx(['期間', 'Period', 'រយៈពេល'], A), periodLabel:label(R.ptype, R.key), scopeLabel:scope,
      generatedAt:tx(['產生 ', 'Generated ', 'បង្កើត '], A) + SEC.nowStr(), sections:secs, signature:{ prepared:P('製表', 'Prepared by', 'រៀបចំដោយ'), reviewed:P('審核', 'Reviewed by', 'ពិនិត្យដោយ'), approved:P('核准', 'Approved by', 'អនុម័តដោយ') },
      headerText:'VRT　' + tx(spec.title, A) + ' ' + tx(tn, A) + '　' + label(R.ptype, R.key), fileName:'VRT_' + tool + '_' + (tn[1].split(' ')[0]) + '_' + label(R.ptype, R.key).replace(/[^0-9A-Za-z-]+/g, '_') + '_' + R.lang + '.docx', summaryPairs:pairs };
  }

  async function generate(tool, R) {
    var docx = await g.ACReportDoc.loadDocx(['shared/docx.iife.js?v=8.5.0']);
    var model = buildModel(tool, R), blob = await docx.Packer.toBlob(g.ACReportDoc.build(docx, model));
    g.ACReportDoc.download(blob, model.fileName);
    return { name:model.fileName, size:blob.size };
  }

  function open(opt) {
    opt = opt || {}; var tool = opt.tool || '', spec0 = REPORTS[tool];
    if (!spec0) { SEC.toast('⚠ ' + L('這一頁還沒有報告功能', 'This page has no report yet', 'ទំព័រនេះមិនទាន់មានរបាយការណ៍'), 'warn'); return null; }
    var spec = Object.assign({}, spec0, { scopeOptions:scopeOpts(spec0) }), ptypes = spec.ptypes || ['week', 'month', 'year'];
    var R = { ptype:opt.ptype || (ptypes.indexOf('month') >= 0 ? 'month' : ptypes[0]), key:'', lang:SEC.lang() === 'zh' ? 'zh-en' : 'en-km', scope:(spec.scopeOptions && spec.scopeOptions[0] && spec.scopeOptions[0].value) || '', note:'', details:false };
    var mask = document.createElement('div'); mask.className = 'mask on'; mask.style.zIndex = 3050;
    var T = SEC.T();
    mask.innerHTML = '<div class="modal" style="max-width:600px"><div class="mh"><span>📝</span><b>' + esc(L('產生報告（Word，僅供參考）', 'Generate report (Word, reference only)', 'បង្កើតរបាយការណ៍ (Word)')) + ' · ' + esc(tx(spec.title, SEC.lang())) + '</b><button class="x" data-close aria-label="' + esc(T.close) + '">×</button></div>' +
      '<div class="mb"><div class="grid g2">' +
        '<div class="f"><label>' + esc(L('報告類型', 'Report type', 'ប្រភេទ')) + '</label><select data-ptype>' + ptypes.map(function (p) { return '<option value="' + p + '">' + esc(tx(TYPE_NAME[p], SEC.lang())) + '</option>'; }).join('') + '</select></div>' +
        '<div class="f"><label>' + esc(L('期間', 'Period', 'រយៈពេល')) + '</label><select data-period></select></div>' +
        '<div class="f"><label>' + esc(L('語言', 'Language', 'ភាសា')) + '</label><select data-lang><option value="zh-en">' + esc(L('中文 + English', 'Chinese + English', 'ចិន + អង់គ្លេស')) + '</option><option value="en-km">' + esc(L('English + ខ្មែរ', 'English + Khmer', 'អង់គ្លេស + ខ្មែរ')) + '</option></select></div>' +
        (spec.scopeOptions ? '<div class="f"><label>' + esc(L('資料範圍', 'Scope', 'វិសាលភាព')) + '</label><select data-scope>' + spec.scopeOptions.map(function (x) { return '<option value="' + esc(x.value) + '">' + esc(tx(x.label, SEC.lang())) + '</option>'; }).join('') + '</select></div>' : '<div></div>') +
      '</div>' +
      '<div class="f" style="margin-top:8px"><label>' + esc(L('補充說明（會寫進管理摘要最前面，可留空）', 'Notes (placed at the top of the summary; optional)', 'កំណត់ចំណាំ (ស្រេចចិត្ត)')) + '</label><textarea data-note rows="2" style="width:100%;border:1px solid var(--line,#dde6ee);border-radius:8px;padding:8px;font:inherit"></textarea></div>' +
      '<div class="f" style="margin-top:8px"><label>' + esc(L('摘要預覽', 'Summary preview', 'មើលជាមុន')) + '</label><div data-preview style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12px;line-height:1.55;max-height:220px;overflow:auto;white-space:pre-wrap"></div></div>' +
      '<p class="hint" data-status style="margin-top:8px"></p></div>' +
      '<div class="mf"><button class="btn gray" data-close>' + esc(T.cancel) + '</button>' + (spec.rows ? '<button class="btn gh" data-excel>📊 Excel</button>' : '') + '<button class="btn" data-go>📝 ' + esc(L('產生 Word 報告', 'Generate Word report', 'បង្កើត Word')) + '</button></div></div>';
    document.body.appendChild(mask);
    var q = function (s) { return mask.querySelector(s); }, close = function () { mask.remove(); };
    mask.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = close; });
    mask.onclick = function (e) { if (e.target === mask) close(); };
    function fillPeriods() {
      var list = [];
      try { list = spec.periods ? (spec.periods(R.ptype) || []) : []; } catch (e) {}
      list = Array.from(new Set(list.map(String))).filter(Boolean).sort().reverse();
      var cur = spec.currentPeriod ? spec.currentPeriod(R.ptype) : new SEC.Period(R.ptype).key();
      if (list.indexOf(cur) < 0) list.unshift(cur);
      if (opt.period && list.indexOf(opt.period) < 0) list.unshift(opt.period);
      R.key = opt.period && list.indexOf(opt.period) >= 0 ? opt.period : (list[0] || cur);
      q('[data-period]').innerHTML = list.map(function (k) { return '<option value="' + esc(k) + '"' + (k === R.key ? ' selected' : '') + '>' + esc(label(R.ptype, k)) + '</option>'; }).join('');
    }
    function preview() {
      try { var m = buildModel(tool, R); q('[data-preview]').textContent = m.summaryPairs.map(function (p) { return (p[2] === 'h' ? '\n【' + p[0] + '】' : p[0]) + (p[1] ? (p[2] === 'h' ? ' ' : '\n   ') + p[1] : ''); }).join('\n').trim() || L('本期沒有資料', 'No data in this period', 'គ្មានទិន្នន័យ'); }
      catch (e) { q('[data-preview]').textContent = '⚠ ' + String(e && e.message || e); }
    }
    q('[data-ptype]').value = R.ptype; q('[data-lang]').value = R.lang;
    fillPeriods(); preview();
    q('[data-ptype]').onchange = function () { R.ptype = this.value; opt.period = ''; fillPeriods(); preview(); };
    q('[data-period]').onchange = function () { R.key = this.value; preview(); };
    q('[data-lang]').onchange = function () { R.lang = this.value; preview(); };
    if (q('[data-scope]')) q('[data-scope]').onchange = function () { R.scope = this.value; preview(); };
    q('[data-note]').oninput = function () { R.note = this.value; };
    var ex = q('[data-excel]'); if (ex) ex.onclick = function () { try { var lang = R.lang === 'en-km' ? 'en' : 'zh', r = spec.rows({ ptype:R.ptype, period:R.key, lang:lang, scope:R.scope, includeDetails:true }); var o = r.rows.map(function (row) { var obj = {}; r.head.forEach(function (h, i) { obj[tx(h, lang) || ('c' + i)] = row[i]; }); return obj; }); SEC.exportExcel([{ name:tx(spec.title, lang).slice(0, 28), rows:o }], 'VRT_' + tool + '_' + label(R.ptype, R.key).replace(/[^0-9A-Za-z-]+/g, '_') + '.xlsx'); } catch (e) { SEC.toast('❌ ' + esc(String(e && e.message || e)), 'err', 0); } };
    q('[data-go]').onclick = async function () {
      var b = this, stt = q('[data-status]'); b.disabled = true; stt.textContent = L('產生中…', 'Generating…', 'កំពុងបង្កើត…');
      try { var r = await generate(tool, R); stt.textContent = '✅ ' + r.name + ' (' + Math.round(r.size / 1024) + ' KB)'; SEC.toast('📝 ' + esc(r.name), 'ok', 4000); }
      catch (e) { stt.textContent = '❌ ' + String(e && e.message || e); SEC.toast('❌ ' + esc(String(e && e.message || e)), 'err', 0); }
      finally { b.disabled = false; }
    };
    return mask;
  }
  SEC.registerReport = registerReport;
  SEC.Report = { open:open, generate:generate, buildModel:buildModel, reports:reports, lines:lines, TYPE_NAME:TYPE_NAME };
})(window);
