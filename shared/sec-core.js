/* ═══════════════════════════════════════════════════════════════════════
   AC Security Platform — shared/sec-core.js  v1.0
   共用引擎：設定 / 三語 / 雲端同步 / 期間導覽 / 智慧 Excel 匯入匯出 /
             照片上傳 / Telegram / 核可送出（兩關 or 直送）
   ═══════════════════════════════════════════════════════════════════════ */
(function (G) {
'use strict';

/* ───────── 設定 ───────── */
var CFG_KEY = 'ac_sec_config';
var DEFAULTS = {
  gasUrl  : 'https://script.google.com/macros/s/AKfycbyxBN_t2AfxTPQ3AYdt7Jxl3pNiJV17H1T0pub4SR8GBgDH47WnDn9JF556KSxUiIU-/exec',
  tgToken : '8619620911:AAHAaXvCVs6N1g0WNxzl84k6MshNd_lKTeM',
  tgChat  : '-5009220114',
  operator: '',
  lang    : 'zh',
  route   : 'review',
};
function getCfg() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function setCfg(o) {
  var c = Object.assign(getCfg(), o || {});
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
  return c;
}

/* ───────── 日期（一律 local getter，永不用 toISOString） ───────── */
function p2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
function hm(d)  { d = d || new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); }
function nowStr(){ return ymd() + ' ' + hm(); }
function parseD(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {              /* Excel 序號 */
    if (v > 20000 && v < 60000) {
      var d0 = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return new Date(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    }
    return null;
  }
  var s = String(v).trim();
  if (!s) return null;
  var m;
  /* 2026-01-02 / 2026/1/2 */
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/)))
    return new Date(+m[1], +m[2] - 1, +m[3]);
  /* 22/8/2017 · 2/1/2026（日/月/年，柬埔寨慣用） */
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/)))
    return new Date(+m[3], +m[2] - 1, +m[1]);
  /* 2026-January-01 / 2026-Jan-01 */
  if ((m = s.match(/^(\d{4})[-\s]([A-Za-z]{3,})[-\s](\d{1,2})/))) {
    var mi = MON.indexOf(m[2].slice(0,3).toLowerCase());
    if (mi >= 0) return new Date(+m[1], mi, +m[3]);
  }
  /* 1-Jan-2026 / 01 January 2026 */
  if ((m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})/))) {
    var mi2 = MON.indexOf(m[2].slice(0,3).toLowerCase());
    if (mi2 >= 0) return new Date(+m[3], mi2, +m[1]);
  }
  var d = new Date(s);
  return isNaN(d) ? null : d;
}
var MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/* ───────── 期間導覽（日 / 週 / 月 / 年） ───────── */
function Period(mode, anchor) {
  this.mode = mode || 'month';
  this.at = anchor ? new Date(anchor) : new Date();
}
Period.prototype.setMode = function (m) { this.mode = m; return this; };
Period.prototype.shift = function (n) {
  var d = this.at;
  if (this.mode === 'day')   d.setDate(d.getDate() + n);
  if (this.mode === 'week')  d.setDate(d.getDate() + n * 7);
  if (this.mode === 'month') d.setMonth(d.getMonth() + n);
  if (this.mode === 'year')  d.setFullYear(d.getFullYear() + n);
  return this;
};
Period.prototype.today = function () { this.at = new Date(); return this; };
Period.prototype.range = function () {
  var d = new Date(this.at), s, e;
  if (this.mode === 'day')   { s = new Date(d); e = new Date(d); }
  else if (this.mode === 'week') {
    var w = d.getDay(); var off = (w === 0 ? -6 : 1 - w);   /* 週一為首 */
    s = new Date(d); s.setDate(d.getDate() + off);
    e = new Date(s); e.setDate(s.getDate() + 6);
  }
  else if (this.mode === 'month') { s = new Date(d.getFullYear(), d.getMonth(), 1);
                                    e = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  else { s = new Date(d.getFullYear(), 0, 1); e = new Date(d.getFullYear(), 11, 31); }
  return { from: ymd(s), to: ymd(e), fromD: s, toD: e };
};
Period.prototype.label = function (lang) {
  var r = this.range(), d = this.at;
  if (this.mode === 'day')   return r.from;
  if (this.mode === 'week')  return r.from + ' ~ ' + r.to;
  if (this.mode === 'month') return d.getFullYear() + '-' + p2(d.getMonth() + 1);
  return String(d.getFullYear());
};
Period.prototype.key = function () {
  var d = this.at;
  if (this.mode === 'day')   return ymd(d);
  if (this.mode === 'week')  return this.range().from;
  if (this.mode === 'month') return d.getFullYear() + '-' + p2(d.getMonth() + 1);
  return String(d.getFullYear());
};
Period.prototype.has = function (dateLike) {
  var d = parseD(dateLike); if (!d) return false;
  var r = this.range();
  var s = ymd(d);
  return s >= r.from && s <= r.to;
};

/* 產生期間導覽 HTML（呼叫端負責掛 onchange） */
function periodNavHtml(id, lang) {
  var L = T(lang);
  return '<div class="pnav" id="' + id + '">' +
    '<div class="pmode">' +
      '<button data-m="day">'   + L.day   + '</button>' +
      '<button data-m="week">'  + L.week  + '</button>' +
      '<button data-m="month" class="on">' + L.month + '</button>' +
      '<button data-m="year">'  + L.year  + '</button>' +
    '</div>' +
    '<button class="parrow" data-n="-1">◀</button>' +
    '<span class="plabel"></span>' +
    '<button class="parrow" data-n="1">▶</button>' +
    '<button class="btn gh sm ptoday" data-today="1">' + L.today + '</button>' +
  '</div>';
}
function bindPeriodNav(id, period, onChange) {
  var el = document.getElementById(id); if (!el) return;
  function paint() {
    el.querySelectorAll('.pmode button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.m === period.mode);
    });
    var lb = el.querySelector('.plabel'); if (lb) lb.textContent = period.label();
  }
  el.addEventListener('click', function (ev) {
    var b = closest(ev.target, 'button'); if (!b) return;
    if (b.dataset.m)     period.setMode(b.dataset.m);
    else if (b.dataset.n) period.shift(parseInt(b.dataset.n, 10));
    else if (b.dataset.today) period.today();
    else return;
    paint(); if (onChange) onChange(period);
  });
  paint();
  return paint;
}

/* 舊版 Android WebView／部分內嵌瀏覽器沒有 Element.closest。 */
function closest(el, selector) {
  var n = el;
  while (n && n !== document) {
    if (n.matches && n.matches(selector)) return n;
    n = n.parentElement || n.parentNode;
  }
  return null;
}

/* ───────── 三語 ───────── */
var BASE_I18N = {
  zh:{ day:'日',week:'週',month:'月',year:'年',today:'今天',
       upload:'上傳雲端',download:'下載雲端',settings:'設定',telegram:'Telegram',
       impExcel:'匯入 Excel',expExcel:'匯出 Excel',backup:'備份 JSON',restore:'還原 JSON',
       save:'儲存',cancel:'取消',del:'刪除',edit:'編輯',add:'新增',close:'關閉',search:'搜尋',
       total:'合計',count:'筆數',date:'日期',time:'時間',remark:'備註',photo:'照片',
       approve:'送出核可',route:'核可路徑',routeReview:'群組審查',routeDirect:'直送核可',
       routeReviewD:'先送群組給 Phea 審查，再由 Paul 核可',routeDirectD:'直接私訊 Paul 核可，一步到位',
       noData:'尚無資料',confirmDel:'確定刪除？',ok:'完成',fail:'失敗',
       cloudOk:'雲端同步完成',cloudFail:'雲端同步失敗',imported:'已匯入',records:'筆' },
  en:{ day:'Day',week:'Week',month:'Month',year:'Year',today:'Today',
       upload:'Upload',download:'Download',settings:'Settings',telegram:'Telegram',
       impExcel:'Import Excel',expExcel:'Export Excel',backup:'Backup JSON',restore:'Restore JSON',
       save:'Save',cancel:'Cancel',del:'Delete',edit:'Edit',add:'Add',close:'Close',search:'Search',
       total:'Total',count:'Count',date:'Date',time:'Time',remark:'Remark',photo:'Photo',
       approve:'Send for Approval',route:'Approval Route',routeReview:'Group Review',routeDirect:'Direct',
       routeReviewD:'Group → Phea reviews → Paul approves',routeDirectD:'Straight to Paul, one step',
       noData:'No data',confirmDel:'Delete this record?',ok:'Done',fail:'Failed',
       cloudOk:'Cloud sync complete',cloudFail:'Cloud sync failed',imported:'Imported',records:'records' },
  km:{ day:'ថ្ងៃ',week:'សប្តាហ៍',month:'ខែ',year:'ឆ្នាំ',today:'ថ្ងៃនេះ',
       upload:'ផ្ទុកឡើង',download:'ទាញយក',settings:'ការកំណត់',telegram:'តេឡេក្រាម',
       impExcel:'នាំចូល Excel',expExcel:'នាំចេញ Excel',backup:'បម្រុងទុក',restore:'ស្តារ',
       save:'រក្សាទុក',cancel:'បោះបង់',del:'លុប',edit:'កែ',add:'បន្ថែម',close:'បិទ',search:'ស្វែងរក',
       total:'សរុប',count:'ចំនួន',date:'កាលបរិច្ឆេទ',time:'ម៉ោង',remark:'កំណត់ចំណាំ',photo:'រូបភាព',
       approve:'ស្នើសុំអនុម័ត',route:'ផ្លូវអនុម័ត',routeReview:'ត្រួតពិនិត្យជាក្រុម',routeDirect:'ផ្ទាល់',
       routeReviewD:'ក្រុម → Phea ត្រួតពិនិត្យ → Paul អនុម័ត',routeDirectD:'ផ្ញើទៅ Paul ដោយផ្ទាល់',
       noData:'គ្មានទិន្នន័យ',confirmDel:'លុបមែនទេ?',ok:'រួចរាល់',fail:'បរាជ័យ',
       cloudOk:'ធ្វើសមកាលកម្មរួច',cloudFail:'បរាជ័យ',imported:'បាននាំចូល',records:'កំណត់ត្រា' },
};
var _lang = getCfg().lang || 'zh';
function T(lang) { return BASE_I18N[lang || _lang] || BASE_I18N.zh; }
function lang() { return _lang; }
function setLang(l) {
  _lang = (['zh','en','km'].indexOf(l) >= 0) ? l : 'zh';
  setCfg({ lang: _lang });
  document.documentElement.lang = _lang === 'zh' ? 'zh-Hant' : (_lang === 'km' ? 'km' : 'en');
  document.querySelectorAll('.lang-sw .lb').forEach(function (b) {
    b.classList.toggle('on', b.dataset.l === _lang);
  });
  applyI18n(document);
  if (G.onLangChange) try { G.onLangChange(_lang); } catch (e) {}
}
/* data-i18n="zh|en|km" 或 data-zh / data-en / data-km */
function applyI18n(root) {
  (root || document).querySelectorAll('[data-zh]').forEach(function (el) {
    var v = el.getAttribute('data-' + _lang) || el.getAttribute('data-zh');
    if (v != null) { if (el.placeholder !== undefined && el.tagName === 'INPUT') el.placeholder = v; else el.textContent = v; }
  });
  (root || document).querySelectorAll('[data-t]').forEach(function (el) {
    var k = el.getAttribute('data-t'), v = T()[k];
    if (v) el.textContent = v;
  });
}

/* ───────── Toast ───────── */
function toast(msg, kind, ms) {
  var w = document.getElementById('toastwrap');
  if (!w) { w = document.createElement('div'); w.id = 'toastwrap'; document.body.appendChild(w); }
  var d = document.createElement('div');
  d.className = 'toast' + (kind ? ' ' + kind : '');
  d.innerHTML = msg;
  w.appendChild(d);
  setTimeout(function () { d.style.transition = '.3s'; d.style.opacity = 0; setTimeout(function(){ d.remove(); }, 320); }, ms || 3000);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ───────── GAS ───────── */
async function gasPost(payload) {
  var c = getCfg();
  if (!c.gasUrl) { toast('⚠ 請先在 ⚙️ 設定填入 GAS URL', 'warn'); throw new Error('no gas url'); }
  var res;
  try {
    res = await fetch(c.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('GAS 網路連線失敗，請確認 /exec 網址與網路狀態');
  }
  var raw = await res.text(), j;
  try { j = JSON.parse(raw); } catch (e) { throw new Error('GAS 回傳不是 JSON：' + raw.slice(0, 120)); }
  if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
  if (j && j.ok === false) throw new Error(j.error || 'GAS error');
  return (j && j.data !== undefined) ? j.data : j;
}

/* 雲端上傳（分塊） */
async function cloudPush(tool, records, summary, extra) {
  var dot = document.querySelector('.c-dot'); if (dot) dot.className = 'c-dot syncing';
  try {
    var json = JSON.stringify(records || []);
    var LIMIT = 300000;
    if (json.length > LIMIT) {
      var per = Math.max(1, Math.floor(records.length / Math.ceil(json.length / LIMIT)));
      var total = Math.ceil(records.length / per);
      for (var i = 0; i < total; i++) {
        await gasPost({ action:'push', tool:tool, chunk:i, totalChunks:total, syncMode:'merge',
          records: records.slice(i*per, (i+1)*per),
          recordCount: records.length, summary: summary || {}, extra: i === total - 1 ? (extra || {}) : {} });
      }
    } else {
      var result = await gasPost({ action:'push', tool:tool, syncMode:'merge', records: records || [],
        recordCount: (records||[]).length, summary: summary || {}, extra: extra || {} });
      if (result && result.keptExisting) toast('ℹ️ 雲端原有較完整資料，已合併保留，沒有刪除較多筆數', 'warn', 5000);
    }
    markSync(tool);
    if (dot) dot.className = 'c-dot ok';
    toast('⬆️☁ ' + T().cloudOk + '（' + (records||[]).length + ' ' + T().records + '）', 'ok');
    return true;
  } catch (e) {
    if (dot) dot.className = 'c-dot err';
    toast('❌ ' + T().cloudFail + '：' + e.message, 'err', 5000);
    return false;
  }
}
/* 雲端下載 */
async function cloudPull(tool) {
  var dot = document.querySelector('.c-dot'); if (dot) dot.className = 'c-dot syncing';
  try {
    var r = await gasPost({ action:'pull', tool:tool });
    var recs = [];
    if (r && r.chunked) {
      for (var i = 0; i < r.chunks; i++) {
        var c = await gasPost({ action:'pull', tool:tool, chunk:i });
        recs = recs.concat(c.records || []);
      }
    } else { recs = (r && r.records) || []; }
    recs._cloudExtra = (r && r.extra) || {};
    recs._cloudMeta = (r && r.meta) || {};
    if (dot) dot.className = 'c-dot ok';
    return recs;
  } catch (e) {
    if (dot) dot.className = 'c-dot err';
    toast('❌ ' + T().cloudFail + '：' + e.message, 'err', 5000);
    return null;
  }
}
function markSync(tool) {
  localStorage.setItem('ac_sec_sync_' + tool, nowStr());
  var ts = document.querySelector('.c-ts'); if (ts) ts.textContent = nowStr();
}
function lastSync(tool) { return localStorage.getItem('ac_sec_sync_' + tool) || '—'; }

/* 雲端／Excel 合併工具：同一筆更新，新增筆保留，絕不因較少資料而清空本機。 */
function recordKey(tool, r, i) {
  r = r || {};
  if (r.id !== undefined && r.id !== '') return tool + '|id|' + r.id;
  if (r.code !== undefined && r.code !== '') return tool + '|code|' + r.code;
  if (r._k !== undefined && r._k !== '') return tool + '|kind|' + r._k + '|' + (r.empId || r.name || r.date || i);
  if (r.month && (r.empId || r.name)) return tool + '|month|' + r.month + '|' + (r.empId || r.name);
  if (r.date && (r.empId || r.name)) return tool + '|date|' + r.date + '|' + (r.empId || r.name);
  if (r.date && r.time && (r.guard || r.person || r.name)) return tool + '|event|' + r.date + '|' + r.time + '|' + (r.guard || r.person || r.name) + '|' + (r.location || r.c || '');
  if (r.t && (r.c || r.g)) return tool + '|scan|' + r.t + '|' + r.c + '|' + (r.g || '');
  return tool + '|row|' + i + '|' + JSON.stringify(r);
}
function mergeRecords(tool, local, incoming) {
  var out = Array.isArray(local) ? local.slice() : [], pos = {};
  out.forEach(function (r, i) { pos[recordKey(tool, r, i)] = i; });
  var added = 0, updated = 0;
  (Array.isArray(incoming) ? incoming : []).forEach(function (r, i) {
    var k = recordKey(tool, r, i);
    if (pos[k] === undefined) { pos[k] = out.length; out.push(r); added++; }
    else { out[pos[k]] = Object.assign({}, out[pos[k]], r); updated++; }
  });
  return { records: out, added: added, updated: updated, kept: Math.max(0, out.length - (incoming || []).length) };
}
function mergeObject(local, incoming) {
  var out = Object.assign({}, local || {});
  Object.keys(incoming || {}).forEach(function (k) {
    if (Array.isArray(out[k]) && Array.isArray(incoming[k])) out[k] = mergeRecords('extra-' + k, out[k], incoming[k]).records;
    else if (incoming[k] && typeof incoming[k] === 'object' && out[k] && typeof out[k] === 'object' && !Array.isArray(incoming[k])) out[k] = mergeObject(out[k], incoming[k]);
    else if (incoming[k] !== undefined) out[k] = incoming[k];
  });
  return out;
}

/* ───────── Telegram 摘要（自動附平台按鈕，由 GAS 加） ───────── */
async function tgSummary(text, module, photo) {
  try {
    await gasPost({ action:'telegram', text:text, module:module||'', lang:_lang, photo:photo||'' });
    toast('✈️ Telegram 已送出', 'ok'); return true;
  } catch (e) { toast('❌ Telegram 失敗：' + e.message, 'err'); return false; }
}

/* ───────── 核可送出（兩種路徑） ───────── */
function routePickerHtml(id) {
  var L = T(), c = getCfg();
  return '<div class="route-pick" id="' + id + '">' +
    '<div class="route-opt' + (c.route !== 'direct' ? ' on' : '') + '" data-r="review">' +
      '<div class="ri">👥</div><div class="rt">' + L.routeReview + '</div><div class="rd">' + L.routeReviewD + '</div></div>' +
    '<div class="route-opt' + (c.route === 'direct' ? ' on' : '') + '" data-r="direct">' +
      '<div class="ri">🚀</div><div class="rt">' + L.routeDirect + '</div><div class="rd">' + L.routeDirectD + '</div></div>' +
  '</div>';
}
function bindRoutePicker(id) {
  var el = document.getElementById(id); if (!el) return;
  el.addEventListener('click', function (ev) {
    var o = closest(ev.target, '.route-opt'); if (!o) return;
    el.querySelectorAll('.route-opt').forEach(function (x) { x.classList.remove('on'); });
    o.classList.add('on');
    setCfg({ route: o.dataset.r });
  });
}
function pickedRoute(id) {
  var el = document.getElementById(id);
  var on = el && el.querySelector('.route-opt.on');
  return on ? on.dataset.r : (getCfg().route || 'review');
}
async function sendApproval(opt) {
  var c = getCfg();
  var body = {
    action : 'approvalRequest',
    module : opt.module,
    period : opt.period || '',
    title  : opt.title || '',
    lang   : _lang,
    route  : opt.route || c.route || 'review',
    requestedBy : c.operator || 'web',
    items  : opt.items || [],
  };
  if (opt.batch) body.batch = opt.batch;
  if (!body.items.length) { toast('⚠ 沒有可送核可的項目', 'warn'); return null; }
  toast('<span class="spin">⏳</span> 送出核可中…（' + body.items.length + ' 筆）');
  try {
    var r = await gasPost(body);
    toast('✅ 已送出核可 <b>' + (r.batchId||'') + '</b>｜' + (r.count||0) + ' 筆｜' +
          (r.route === 'direct' ? '🚀 直送核可' : '👥 群組審查'), 'ok', 5000);
    return r;
  } catch (e) { toast('❌ 送出失敗：' + e.message, 'err', 6000); return null; }
}

/* ───────── 照片（壓縮成 dataURL，免後端） ───────── */
function pickPhoto(cb, maxW) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = function () {
    Array.prototype.forEach.call(inp.files || [], function (f) { compressImage(f, maxW || 1000, cb); });
  };
  inp.click();
}
function compressImage(file, maxW, cb) {
  var fr = new FileReader();
  fr.onload = function () {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.72), file.name);
    };
    img.onerror = function () { cb(fr.result, file.name); };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}
function photoListHtml(arr, editable) {
  if (!arr || !arr.length) return '';
  return '<div class="photo-list">' + arr.map(function (p, i) {
    return '<div class="photo-item"><img src="' + p + '" onclick="SEC.viewPhoto(\'' + i + '\',this)">' +
      (editable ? '<button class="del" data-i="' + i + '">×</button>' : '') + '</div>';
  }).join('') + '</div>';
}
function viewPhoto(i, el) {
  var src = el && el.src; if (!src) return;
  var m = document.createElement('div');
  m.className = 'mask on';
  m.style.zIndex = 3000;
  m.innerHTML = '<img src="' + src + '" style="max-width:96vw;max-height:92vh;border-radius:12px">';
  m.onclick = function () { m.remove(); };
  document.body.appendChild(m);
}

/* ═══════════════════════════════════════════════════════════════════════
   ★ 智慧 Excel 匯入 —— 解決「匯入 0 筆」的核心
   處理：多重標題列、合併儲存格、每張表一個月/一個人、標題不在第 1 列、
        中英柬緬多語標題、日期欄空白沿用上一列
   ═══════════════════════════════════════════════════════════════════════ */

/* 讀檔 → 每張工作表的二維陣列 */
function readWorkbook(file, cb) {
  var fr = new FileReader();
  fr.onload = function (e) {
    try {
      if (typeof XLSX === 'undefined') throw new Error('Excel 元件尚未載入');
      var wb = XLSX.read(new Uint8Array(e.target.result), { type:'array', cellDates:false, raw:true });
      var sheets = wb.SheetNames.map(function (n) {
        return { name:n, fileName:file.name || '', rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true, blankrows:false }) };
      });
      cb(sheets, wb);
    } catch (err) {
      toast('❌ Excel 讀取失敗：' + err.message + '。請重新整理後再試。', 'err', 7000);
    }
  };
  fr.readAsArrayBuffer(file);
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\s\u3000\n\r]+/g, '').replace(/[：:()（）.．_\-\/]/g, '');
}

/* 在前 N 列裡找出最像「標題列」的那一列
   spec = { key1:[別名...], key2:[...] }，回傳 {row, map:{key→colIdx}, score} */
function findHeader(rows, spec, maxScan) {
  maxScan = Math.min(rows.length, maxScan || 15);
  var keys = Object.keys(spec);
  var best = null;
  for (var r = 0; r < maxScan; r++) {
    var map = {}, score = 0;
    /* 允許標題橫跨 2 列（第 r 列 + 第 r+1 列合併判斷） */
    for (var c = 0; c < (rows[r] || []).length; c++) {
      var a = norm(rows[r][c]);
      var b = rows[r+1] ? norm(rows[r+1][c]) : '';
      keys.forEach(function (k) {
        if (map[k] !== undefined) return;
        var hit = spec[k].some(function (alias) {
          var n = norm(alias);
          return n && (a === n || b === n || (a && a.indexOf(n) >= 0) || (b && b.indexOf(n) >= 0));
        });
        if (hit) { map[k] = c; score++; }
      });
    }
    if (!best || score > best.score) best = { row:r, map:map, score:score };
    if (score >= keys.length) break;
  }
  return best || { row:0, map:{}, score:0 };
}

/* 通用列解析：自動找標題 → 逐列轉物件 → 日期空白沿用上一列 */
function parseSheet(rows, spec, opt) {
  opt = opt || {};
  var h = findHeader(rows, spec, opt.scan);
  if (h.score < (opt.minScore || 2)) return { rows:[], header:h };
  var start = h.row + 1;
  /* 跳過緊接的第二層標題/單位列 */
  while (start < rows.length && isHeaderish(rows[start], h.map)) start++;
  var out = [], lastDate = '';
  for (var i = start; i < rows.length; i++) {
    var R = rows[i] || [];
    if (!R.length) continue;
    var o = {};
    Object.keys(h.map).forEach(function (k) { o[k] = R[h.map[k]]; });
    /* 日期沿用（合併儲存格常見） */
    if (h.map.date !== undefined) {
      var d = parseD(o.date);
      if (d) lastDate = ymd(d); else if (lastDate) o.date = lastDate;
      if (d) o.date = ymd(d);
    }
    if (opt.filter && !opt.filter(o, R)) continue;
    if (!opt.filter && isEmptyRow(o)) continue;
    o._row = i + 1;
    out.push(o);
  }
  return { rows: out, header: h };
}
function isHeaderish(R, map) {
  if (!R) return false;
  var vals = Object.keys(map).map(function (k) { return norm(R[map[k]]); }).filter(Boolean);
  if (!vals.length) return false;
  /* 全是非數字文字且很短 → 多半是第二層標題 */
  return vals.every(function (v) { return v.length <= 14 && !/^\d+(\.\d+)?$/.test(v) && !/^\d{4}/.test(v); });
}
function isEmptyRow(o) {
  return !Object.keys(o).some(function (k) {
    var v = o[k];
    return v !== '' && v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== '_';
  });
}
function num(v) {
  if (v === '' || v == null) return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function str(v) { var s = String(v == null ? '' : v).trim(); return (s === '_' || s === '-') ? '' : s; }

/* ── 匯出 Excel（多工作表） ── */
function exportExcel(sheets, filename) {
  if (typeof XLSX === 'undefined') { toast('❌ Excel 元件未載入，請重新整理後再試', 'err', 6000); return; }
  var wb = XLSX.utils.book_new();
  sheets.forEach(function (s) {
    var ws = Array.isArray(s.rows[0]) ? XLSX.utils.aoa_to_sheet(s.rows)
                                      : XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, String(s.name || 'Sheet').slice(0, 30));
  });
  XLSX.writeFile(wb, filename || ('AC_SEC_' + ymd() + '.xlsx'));
  toast('📊 Excel 已匯出', 'ok');
}
/* ── JSON 備份 / 還原 ── */
function backupJson(obj, filename) {
  var b = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = filename || ('AC_SEC_backup_' + ymd() + '.json');
  a.click();
  toast('💾 備份完成', 'ok');
}
function restoreJson(cb) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = function () {
    var f = inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try { cb(JSON.parse(fr.result)); toast('✅ 還原完成', 'ok'); }
      catch (e) { toast('❌ 檔案格式錯誤', 'err'); }
    };
    fr.readAsText(f);
  };
  inp.click();
}
function pickExcel(cb) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
  inp.onchange = function () {
    if (!inp.files[0]) return;
    if (typeof XLSX === 'undefined') { toast('❌ Excel 元件未載入，請重新整理後再試', 'err', 6000); return; }
    readWorkbook(inp.files[0], cb);
  };
  inp.click();
}

/* ───────── 共用 Header ───────── */
function headerHtml(icon, title, sub) {
  var L = T();
  return '<div class="hdr">' +
    '<div class="hdr-top">' +
      '<div class="hdr-ic">' + icon + '</div>' +
      '<div><div class="hdr-t1">' + esc(title) + '</div><div class="hdr-t2">' + esc(sub || 'AC SECURITY PLATFORM') + '</div></div>' +
      '<div class="hdr-right">' +
        '<div class="lang-sw">' +
          '<button class="lb" data-l="zh">繁中</button>' +
          '<button class="lb" data-l="en">EN</button>' +
          '<button class="lb" data-l="km">ខ្មែរ</button>' +
        '</div>' +
        '<button class="ic-btn" id="btnUp"   title="' + L.upload   + '">⬆️☁</button>' +
        '<button class="ic-btn" id="btnDown" title="' + L.download + '">⬇️☁</button>' +
        '<button class="ic-btn" id="btnTg"   title="Telegram">✈️</button>' +
        '<button class="ic-btn" id="btnCfg"  title="' + L.settings + '">⚙️</button>' +
        '<a class="ic-btn" href="index.html" title="Portal">🏠</a>' +
      '</div>' +
    '</div>' +
    '<div class="cloud-bar" id="cloudBar">' +
      '<span class="c-dot"></span><span class="c-lbl">☁ Cloud</span>' +
      '<span class="c-ts">—</span>' +
    '</div>' +
  '</div>';
}
function bindHeader(tool, handlers) {
  document.querySelectorAll('.lang-sw .lb').forEach(function (b) {
    b.onclick = function () { setLang(b.dataset.l); };
  });
  var ts = document.querySelector('.c-ts'); if (ts) ts.textContent = lastSync(tool);
  function bindAction(id, fn) {
    var el = document.getElementById(id); if (!el || typeof fn !== 'function') return;
    el.onclick = function (ev) {
      try {
        var out = fn(ev);
        if (out && typeof out.catch === 'function') out.catch(function (e) { bootError(e); });
      } catch (e) { bootError(e); }
    };
  }
  bindAction('btnUp', handlers.onUpload);
  bindAction('btnDown', handlers.onDownload);
  bindAction('btnTg', handlers.onTelegram);
  var cf = document.getElementById('btnCfg');  if (cf)   cf.onclick   = openSettings;
  setLang(getCfg().lang || 'zh');
}

/* 如果頁面初始化或按鈕事件出錯，直接在畫面顯示原因，避免「完全沒反應」。 */
function bootError(e) {
  var msg = String(e && e.message || e || 'Unknown JavaScript error');
  try { console.error('[AC SEC]', e); } catch (_) {}
  var b = document.getElementById('secBootError');
  if (!b) {
    b = document.createElement('div'); b.id = 'secBootError';
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99998;background:#991b1b;color:#fff;padding:11px 14px;border-radius:10px;font:600 12px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28)';
    document.body.appendChild(b);
  }
  b.innerHTML = '⚠️ JavaScript / JavaScript 錯誤：' + esc(msg) + '<br><small>請重新整理；若仍存在，請把這行錯誤文字回傳。</small>';
}
try {
  G.addEventListener('error', function (ev) { if (ev && ev.error) bootError(ev.error); });
  G.addEventListener('unhandledrejection', function (ev) { if (ev && ev.reason) bootError(ev.reason); });
} catch (_) {}

/* ───────── 設定 Modal ───────── */
function openSettings() {
  var c = getCfg();
  var m = document.getElementById('secCfgMask');
  if (!m) {
    m = document.createElement('div');
    m.id = 'secCfgMask'; m.className = 'mask';
    m.innerHTML =
      '<div class="modal"><div class="mh"><span>⚙️</span><b>平台設定 Settings</b>' +
      '<button class="x" onclick="SEC.closeSettings()">×</button></div>' +
      '<div class="mb"><div class="grid">' +
        '<div class="f"><label>GAS Web App URL（/exec）</label><input id="cfgGas"></div>' +
        '<div class="f"><label>Telegram Bot Token</label><input id="cfgTok"></div>' +
        '<div class="f"><label>Telegram Chat ID</label><input id="cfgChat"></div>' +
        '<div class="f"><label>操作者 Operator</label><input id="cfgOp" placeholder="你的名字"></div>' +
        '<div class="f"><label>預設核可路徑 Default Route</label>' +
          '<select id="cfgRoute"><option value="review">👥 群組審查 → 核可</option>' +
          '<option value="direct">🚀 直送核可</option></select></div>' +
      '</div>' +
      '<div class="sep"></div>' +
      '<div class="row"><button class="btn gh sm" onclick="SEC.pingGas()">🔌 測試連線</button>' +
      '<button class="btn gh sm" onclick="SEC.tgTest()">✈️ 測試 Telegram</button>' +
      '<button class="btn gh sm" onclick="SEC.sendMenu()">📱 推送模組選單</button></div>' +
      '<p class="hint" style="margin-top:9px">設定儲存在本機瀏覽器。GAS URL 已預先填好，通常不需修改。</p>' +
      '</div><div class="mf"><button class="btn gray" onclick="SEC.closeSettings()">取消</button>' +
      '<button class="btn" onclick="SEC.saveSettings()">儲存</button></div></div>';
    document.body.appendChild(m);
  }
  document.getElementById('cfgGas').value  = c.gasUrl;
  document.getElementById('cfgTok').value  = c.tgToken;
  document.getElementById('cfgChat').value = c.tgChat;
  document.getElementById('cfgOp').value   = c.operator;
  document.getElementById('cfgRoute').value= c.route || 'review';
  m.classList.add('on');
}
function closeSettings() { var m = document.getElementById('secCfgMask'); if (m) m.classList.remove('on'); }
function saveSettings() {
  setCfg({
    gasUrl  : document.getElementById('cfgGas').value.trim(),
    tgToken : document.getElementById('cfgTok').value.trim(),
    tgChat  : document.getElementById('cfgChat').value.trim(),
    operator: document.getElementById('cfgOp').value.trim(),
    route   : document.getElementById('cfgRoute').value,
  });
  closeSettings(); toast('✅ 設定已儲存', 'ok');
}
async function pingGas() {
  try { var r = await gasPost({ action:'ping' }); toast('✅ GAS 連線正常 ' + (r.ts||''), 'ok'); }
  catch (e) { toast('❌ 連線失敗：' + e.message, 'err', 5000); }
}
async function tgTest() {
  try { await gasPost({ action:'telegram', text:'🧪 <b>AC Security 連線測試</b>\n' + nowStr(), lang:_lang });
        toast('✅ 已送出，請看群組', 'ok'); }
  catch (e) { toast('❌ 失敗：' + e.message, 'err', 5000); }
}
async function sendMenu() {
  try { await gasPost({ action:'secMenu', lang:_lang }); toast('✅ 選單已推送到群組', 'ok'); }
  catch (e) { toast('❌ 失敗：' + e.message, 'err'); }
}

/* ───────── Modal 工具 ───────── */
function openModal(id) { var m = document.getElementById(id); if (m) m.classList.add('on'); }
function closeModal(id) { var m = document.getElementById(id); if (m) m.classList.remove('on'); }

/* ───────── 匯出 ───────── */
G.SEC = {
  CFG_KEY:CFG_KEY, getCfg:getCfg, setCfg:setCfg,
  p2:p2, ymd:ymd, hm:hm, nowStr:nowStr, parseD:parseD, num:num, str:str, esc:esc,
  closest:closest, bootError:bootError,
  Period:Period, periodNavHtml:periodNavHtml, bindPeriodNav:bindPeriodNav,
  T:T, lang:lang, setLang:setLang, applyI18n:applyI18n, I18N:BASE_I18N,
  toast:toast, gasPost:gasPost, cloudPush:cloudPush, cloudPull:cloudPull,
  markSync:markSync, lastSync:lastSync, tgSummary:tgSummary,
  recordKey:recordKey, mergeRecords:mergeRecords, mergeObject:mergeObject,
  routePickerHtml:routePickerHtml, bindRoutePicker:bindRoutePicker, pickedRoute:pickedRoute,
  sendApproval:sendApproval,
  pickPhoto:pickPhoto, compressImage:compressImage, photoListHtml:photoListHtml, viewPhoto:viewPhoto,
  readWorkbook:readWorkbook, pickExcel:pickExcel, findHeader:findHeader, parseSheet:parseSheet,
  norm:norm, exportExcel:exportExcel, backupJson:backupJson, restoreJson:restoreJson,
  headerHtml:headerHtml, bindHeader:bindHeader,
  openSettings:openSettings, closeSettings:closeSettings, saveSettings:saveSettings,
  pingGas:pingGas, tgTest:tgTest, sendMenu:sendMenu,
  openModal:openModal, closeModal:closeModal,
};
})(window);
