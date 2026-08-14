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
var MEM_CFG = null;
var STORAGE_WARNED = false;
var DATA_DB_NAME = 'ac_sec_data_v1';
var DATA_DB_STORE = 'records';
var DATA_DB = null;
var DATA_READY = null;
var DATA_QUEUE = {};

/* localStorage 滿時不能讓初始化中斷。只整理同步時間標記，絕不刪除業務資料。 */
function storageQuota(e) {
  var s = String(e && (e.name || e.message) || e || '').toLowerCase();
  return s.indexOf('quota') >= 0 || s.indexOf('storage') >= 0 || s.indexOf('exceed') >= 0;
}
function storageWarn() {
  if (STORAGE_WARNED) return;
  STORAGE_WARNED = true;
  try { toast('⚠ 本機儲存空間已滿：設定仍可使用，但新資料暫存於本分頁；請先匯出或下載雲端資料，再清理舊網站資料。', 'warn', 8000); } catch (_) {}
}
function clearSyncMarkers() {
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && /^ac_sec_sync_/.test(k)) localStorage.removeItem(k);
    }
  } catch (_) {}
}
function safeStorageGet(key) {
  var v = null;
  if (key === CFG_KEY) {
    try { v = sessionStorage.getItem(key); } catch (_) {}
    if (v) return v;
  }
  try { v = localStorage.getItem(key); } catch (_) {}
  if (v) return v;
  if (key !== CFG_KEY) {
    try { v = sessionStorage.getItem(key); } catch (_) {}
  }
  return v;
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) {
    /* 設定可能是舊版留下的巨大物件；先只移除設定本身再寫入精簡版。 */
    if (key === CFG_KEY) {
      try { localStorage.removeItem(CFG_KEY); localStorage.setItem(key, value); return true; } catch (_) {}
    }
    if (storageQuota(e)) clearSyncMarkers();
    try { localStorage.setItem(key, value); return true; } catch (_) {}
    try { sessionStorage.setItem(key, value); storageWarn(); return true; } catch (_) {}
    storageWarn();
    return false;
  }
}
function normalizeCfg(c) {
  c = c || {};
  return {
    gasUrl: c.gasUrl == null ? DEFAULTS.gasUrl : String(c.gasUrl).slice(0, 1000),
    tgToken: c.tgToken == null ? DEFAULTS.tgToken : String(c.tgToken).slice(0, 500),
    tgChat: c.tgChat == null ? DEFAULTS.tgChat : String(c.tgChat).slice(0, 120),
    operator: c.operator == null ? '' : String(c.operator).slice(0, 120),
    lang: ['zh','en','km'].indexOf(c.lang) >= 0 ? c.lang : DEFAULTS.lang,
    route: c.route === 'direct' ? 'direct' : 'review',
  };
}

/* ───────── 大量業務資料：IndexedDB（瀏覽器資料庫） ─────────
   localStorage 只保留設定；巡邏、CCTV、出勤原始明細等改存 IndexedDB，
   第一次開啟時自動搬移舊 ac_sec_* JSON，成功後移除舊副本。 */
function openDataDb() {
  if (!G.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
  if (DATA_DB) return Promise.resolve(DATA_DB);
  return new Promise(function (resolve, reject) {
    var req;
    try { req = G.indexedDB.open(DATA_DB_NAME, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(DATA_DB_STORE)) db.createObjectStore(DATA_DB_STORE);
    };
    req.onsuccess = function () {
      DATA_DB = req.result;
      DATA_DB.onversionchange = function () { DATA_DB.close(); DATA_DB = null; };
      resolve(DATA_DB);
    };
    req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
  });
}
function idbGet(db, key) {
  return new Promise(function (resolve, reject) {
    var tx = db.transaction([DATA_DB_STORE], 'readonly'), req = tx.objectStore(DATA_DB_STORE).get(key);
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB read failed')); };
  });
}
function idbPut(db, key, value) {
  return new Promise(function (resolve, reject) {
    var tx = db.transaction([DATA_DB_STORE], 'readwrite'), req = tx.objectStore(DATA_DB_STORE).put(value, key), done = false;
    function fail(e) { if (!done) { done = true; reject(e || new Error('IndexedDB write failed')); } }
    tx.oncomplete = function () { if (!done) { done = true; resolve(true); } };
    tx.onerror = function () { fail(tx.error); };
    tx.onabort = function () { fail(tx.error || new Error('IndexedDB write aborted')); };
    req.onerror = function () { fail(req.error); };
  });
}
function migrateLegacyData() {
  return openDataDb().then(function (db) {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (/^ac_sec_/.test(k) || /^(vrt_truck_v2|vr-container-inspections|vrt_v2)$/.test(k)) && k !== CFG_KEY && !/^ac_sec_sync_/.test(k)) keys.push(k);
      }
    } catch (_) { return true; }
    return keys.reduce(function (p, key) {
      return p.then(function () {
        var raw = safeStorageGet(key), value;
        if (!raw) return null;
        try { value = JSON.parse(raw); } catch (_) { return null; }
        return idbPut(db, key, value).then(function () {
          try { localStorage.removeItem(key); } catch (_) {}
          return null;
        });
      });
    }, Promise.resolve()).then(function () { return true; });
  }).catch(function () { return false; });
}
function dataReady() {
  if (!DATA_READY) DATA_READY = migrateLegacyData();
  return DATA_READY;
}
function legacyValue(key, fallback) {
  var raw = safeStorageGet(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}
function dbGet(key, fallback) {
  return dataReady().then(function () {
    return openDataDb().then(function (db) { return idbGet(db, key); }).then(function (v) {
      return v === undefined ? legacyValue(key, fallback) : v;
    });
  }).catch(function () { return legacyValue(key, fallback); });
}
function dbPut(key, value) {
  var q = DATA_QUEUE[key] || Promise.resolve();
  DATA_QUEUE[key] = q.then(function () {
    return openDataDb().then(function (db) { return idbPut(db, key, value); });
  }).catch(function () {
    safeStorageSet(key, JSON.stringify(value));
    return false;
  });
  return DATA_QUEUE[key];
}
function storageEstimate() {
  try {
    if (G.navigator && G.navigator.storage && G.navigator.storage.estimate)
      return G.navigator.storage.estimate();
  } catch (_) {}
  return Promise.resolve({ usage: 0, quota: 0 });
}
function getCfg() {
  var raw = safeStorageGet(CFG_KEY), saved = {};
  try { saved = raw ? JSON.parse(raw) : {}; } catch (_) { saved = {}; }
  return normalizeCfg(Object.assign({}, DEFAULTS, saved, MEM_CFG || {}));
}
function setCfg(o) {
  var c = normalizeCfg(Object.assign({}, getCfg(), o || {}));
  if (!safeStorageSet(CFG_KEY, JSON.stringify(c))) MEM_CFG = c;
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

/* ───────── HRA Pay 同步習慣：摘要／核可後自動上傳及失敗重試 ─────────
   只在 localStorage 留一個很小的待辦標記；實際資料仍由各模組的
   doUpload() 讀取，避免把整份資料塞進瀏覽器儲存空間。 */
var SEC_AUTO_UPLOADERS = {};
function registerAutoUploader(tool, fn) {
  if (tool && typeof fn === 'function') SEC_AUTO_UPLOADERS[String(tool)] = fn;
}
function autoSyncKey(tool) { return 'ac_sec_auto_sync_' + String(tool || ''); }
function scheduleAutoCloudSync(tool, reason, period) {
  tool = String(tool || ''); if (!tool) return;
  var marker = { tool:tool, reason:String(reason || 'event'), period:String(period || ''), at:Date.now() };
  try { safeStorageSet(autoSyncKey(tool), JSON.stringify(marker)); } catch (e) {}
  setTimeout(function () {
    var fn = SEC_AUTO_UPLOADERS[tool];
    if (typeof fn !== 'function') return;
    Promise.resolve().then(function () { return fn({ silent:true, auto:true, reason:marker.reason, period:marker.period }); })
      .then(function (ok) {
        if (ok !== false) {
          try { localStorage.removeItem(autoSyncKey(tool)); } catch (e) {}
          toast('☁️ 自動保存完成 / Auto cloud save complete', 'ok', 3500);
        }
      }).catch(function () { /* 保留標記，下一次開頁時重試 */ });
  }, 20);
}
function retryAutoCloudSync(tool) {
  tool = String(tool || ''); if (!tool) return;
  var raw = null;
  try { raw = localStorage.getItem(autoSyncKey(tool)); } catch (e) {}
  if (!raw) return;
  var m = {}; try { m = JSON.parse(raw) || {}; } catch (e) {}
  scheduleAutoCloudSync(tool, m.reason || 'retry', m.period || '');
}

/* 雲端上傳（分塊） */
async function cloudPush(tool, records, summary, extra) {
  var dot = document.querySelector('.c-dot'); if (dot) dot.className = 'c-dot syncing';
  try {
    /* 每次成功上傳都留下版本時間，下載時才能判斷哪一筆較新，不能再用筆數大小猜測。 */
    var syncAt = new Date().toISOString();
    (Array.isArray(records) ? records : []).forEach(function (r) {
      if (r && typeof r === 'object' && !r.updatedAt) r.updatedAt = syncAt;
    });
    Object.keys(extra || {}).forEach(function (k) {
      if (Array.isArray(extra[k])) extra[k].forEach(function (r) {
        if (r && typeof r === 'object' && !r.updatedAt) r.updatedAt = syncAt;
      });
    });
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
  safeStorageSet('ac_sec_sync_' + tool, nowStr());
  var ts = document.querySelector('.c-ts'); if (ts) ts.textContent = nowStr();
}
function lastSync(tool) { return localStorage.getItem('ac_sec_sync_' + tool) || '—'; }

/* 雲端／Excel 合併工具：同一筆更新，新增筆保留，絕不因較少資料而清空本機。 */
function recordKey(tool, r, i) {
  r = r || {};
  /* CCTV 的穩定識別碼是攝影機編號，不是每次匯入產生的隨機 id；
     舊版本曾因 id 不同，把同一支攝影機重複加入。 */
  if (tool === 'cctv') {
    /* 只接受 CCTV A-01／CCTV B-01 類正式編號；摘要文字及純數字列另行隔離。 */
    var cctvVals = [r.code, r.name], cctvKey = '';
    for (var ci = 0; ci < cctvVals.length; ci++) {
      var rawCctv = String(cctvVals[ci] || '').trim().toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
      var cctvMatch = rawCctv.match(/^(?:CCTV|CAM(?:ERA)?)?\s*[-_ ]*([AB])\s*[-_ ]*([0-9]{1,3})$/);
      if (cctvMatch && parseInt(cctvMatch[2], 10)) {
        cctvKey = cctvMatch[1] + '-' + parseInt(cctvMatch[2], 10); break;
      }
    }
    if (cctvKey) return tool + '|code|' + cctvKey;
    return tool + '|invalid|' + (r.id || i);
  }
  if (r.id !== undefined && r.id !== '') return tool + '|id|' + r.id;
  if (r.code !== undefined && r.code !== '') return tool + '|code|' + r.code;
  if (r._k !== undefined && r._k !== '') return tool + '|kind|' + r._k + '|' + (r.empId || r.name || r.date || i);
  if (r.month && (r.empId || r.name)) return tool + '|month|' + r.month + '|' + (r.empId || r.name);
  if (r.date && (r.empId || r.name)) return tool + '|date|' + r.date + '|' + (r.empId || r.name);
  if (r.date && r.time && (r.guard || r.person || r.name)) return tool + '|event|' + r.date + '|' + r.time + '|' + (r.guard || r.person || r.name) + '|' + (r.location || r.c || '');
  /* 巡更棒整月表有時沒有 Person、每日表有 Person；同一時間同一 Chip 應視為同一筆打點。 */
  if (tool === 'patrol' && r.t && r.c) return tool + '|scan|' + r.t + '|' + r.c;
  if (r.t && (r.c || r.g)) return tool + '|scan|' + r.t + '|' + r.c + '|' + (r.g || '');
  return tool + '|row|' + i + '|' + JSON.stringify(r);
}
function blankValue(v) { return v === undefined || v === null || String(v).trim() === ''; }
function recordStamp(r) {
  r = r || {};
  var vals = [r.updatedAt, r.modifiedAt, r.lastUpdated, r.createdAt, r.timestamp, r.lastCheck];
  for (var i = 0; i < vals.length; i++) if (!blankValue(vals[i])) {
    var d = Date.parse(String(vals[i]).replace(' ', 'T'));
    if (!isNaN(d)) return d;
  }
  var ds = !blankValue(r.date) ? String(r.date) : (!blankValue(r.month) ? String(r.month) : '');
  if (!blankValue(r.time)) ds += ' ' + String(r.time);
  var dt = ds ? Date.parse(ds.replace(/-/g, '/')) : NaN;
  return isNaN(dt) ? 0 : dt;
}
function mergeLatestRow(oldRow, newRow) {
  var oldStamp = recordStamp(oldRow), newStamp = recordStamp(newRow);
  /* 沒有時間戳時，下載／匯入的 incoming 視為目前要套用的版本；
     但 incoming 空白欄位一律保留舊的非空內容。 */
  var newWins = oldStamp === 0 ? true : (newStamp === 0 ? false : newStamp >= oldStamp);
  var winner = newWins ? newRow : oldRow, other = newWins ? oldRow : newRow;
  var merged = Object.assign({}, other || {}, winner || {}), blanks = [];
  Object.keys(winner || {}).forEach(function (k) {
    if (blankValue(winner[k]) && !blankValue(other && other[k])) {
      merged[k] = other[k]; blanks.push(k);
    }
  });
  return { row:merged, blanks:blanks, incomingWins:newWins };
}
function mergeRecords(tool, local, incoming) {
  var out = [], pos = {}, blankConflicts = [], added = 0, updated = 0;
  function apply(r, i, isIncoming) {
    var k = recordKey(tool, r, i);
    if (pos[k] === undefined) { pos[k] = out.length; out.push(r); if (isIncoming) added++; }
    else {
      var m = mergeLatestRow(out[pos[k]], r); out[pos[k]] = m.row;
      if (isIncoming) { updated++; if (m.blanks.length) blankConflicts.push({ key:k, fields:m.blanks }); }
    }
  }
  (Array.isArray(local) ? local : []).forEach(function (r, i) { apply(r, i, false); });
  (Array.isArray(incoming) ? incoming : []).forEach(function (r, i) { apply(r, i, true); });
  return { records: out, added: added, updated: updated,
    kept: Math.max(0, out.length - (incoming || []).length), blankConflicts:blankConflicts };
}
function mergeObject(local, incoming) {
  var out = Object.assign({}, local || {});
  Object.keys(incoming || {}).forEach(function (k) {
    if (Array.isArray(out[k]) && Array.isArray(incoming[k])) out[k] = mergeRecords('extra-' + k, out[k], incoming[k]).records;
    else if (incoming[k] && typeof incoming[k] === 'object' && out[k] && typeof out[k] === 'object' && !Array.isArray(incoming[k])) out[k] = mergeObject(out[k], incoming[k]);
    else if (incoming[k] !== undefined && !(blankValue(incoming[k]) && !blankValue(out[k]))) out[k] = incoming[k];
  });
  return out;
}
function blankConflictsObject(local, incoming, path, out) {
  path = path || ''; out = out || [];
  if (!incoming || typeof incoming !== 'object') return out;
  Object.keys(incoming).forEach(function (k) {
    var p = path ? path + '.' + k : k, nv = incoming[k], ov = local && local[k];
    if (nv && typeof nv === 'object' && !Array.isArray(nv)) blankConflictsObject(ov || {}, nv, p, out);
    else if (blankValue(nv) && !blankValue(ov)) out.push(p);
  });
  return out;
}
function confirmBlankMerge(conflicts, title) {
  if (!conflicts || !conflicts.length) return true;
  var sample = conflicts.slice(0, 12).map(function (x) { return typeof x === 'string' ? x : (x.key || ''); }).filter(Boolean).join('\n· ');
  return typeof G.confirm !== 'function' || G.confirm((title || '下載資料') + '\n\n' +
    '發現 ' + conflicts.length + ' 個空白欄位。按「確定」會保留原本非空資料並略過空白，不會清除內容。\n' +
    'Blank fields found. Confirm to keep existing non-blank values and skip blanks.\n\n· ' + sample);
}

/* ───────── Telegram 摘要（自動附平台按鈕，由 GAS 加） ───────── */
async function tgSummary(text, module, photo, photos) {
  try {
    var list = Array.isArray(photos) ? photos.filter(Boolean).slice(0, 4) : [];
    if (photo && !list.length) list = [photo];
    await gasPost({ action:'telegram', text:text, module:module||'', lang:_lang,
      photo:list[0] || '', photos:list });
    scheduleAutoCloudSync(module || '', 'telegram-summary', '');
    toast('✈️ Telegram 已送出', 'ok'); return true;
  } catch (e) { toast('❌ Telegram 失敗：' + e.message, 'err'); return false; }
}

/* ───────── Telegram 摘要／核可選擇器（Security 版 GA exp TG.open） ─────────
   讓每個模組都能先選：摘要或核可、日／週／月／年、期間、語言，再送出。
   核可項目由頁面自行提供，後端仍會再次限制只有保安服務費可送核可。 */
function tgAnchor(key, type) {
  var s = String(key || '');
  if (type === 'year' && /^\d{4}$/.test(s)) return new Date(+s, 0, 1);
  if (type === 'month' && /^\d{4}-\d{2}$/.test(s)) return new Date(+s.slice(0,4), +s.slice(5,7)-1, 1);
  return parseD(s) || new Date();
}
function tgPeriodLabel(key, type) { return new Period(type, tgAnchor(key, type)).label(); }
function tgOpen(opt) {
  opt = opt || {};
  var firstType = opt.defaultType || 'month';
  var st = { mode:'summary', ptype:firstType, period:opt.defaultPeriod || '',
    lang:opt.defaultLang || 'both', scope:opt.defaultScope || (opt.scopeOptions && opt.scopeOptions[0] ? opt.scopeOptions[0].value : '') };
  var mask = document.createElement('div');
  mask.className = 'mask on';
  var scopeHtml = opt.scopeOptions && opt.scopeOptions.length ?
    '<div class="f"><label>資料範圍 Scope</label><select id="tgScope">' + opt.scopeOptions.map(function (x) {
      return '<option value="' + esc(x.value) + '">' + esc(x.label) + '</option>';
    }).join('') + '</select></div>' : '';
  var langHtml = '<option value="both">繁中 + English</option><option value="zh">繁體中文</option><option value="en">English</option><option value="km">ខ្មែរ</option>';
  mask.innerHTML =
    '<div class="modal" style="max-width:560px">' +
      '<div class="mh"><span>✈️</span><b>Telegram 摘要／核可</b>' +
        '<button class="x" data-tg-close>×</button></div>' +
      '<div class="mb">' +
        '<div class="f"><label>傳送模式 Mode</label><div class="row" id="tgMode">' +
          '<button class="btn sm" data-tg-mode="summary">📄 摘要 Summary</button>' +
          (opt.canApprove ? '<button class="btn sm gh" data-tg-mode="approval">✅ 保安費核可 Approval</button>' : '') +
        '</div></div>' +
        '<div class="grid ' + (scopeHtml ? 'g3' : 'g2') + '" style="margin-top:10px">' +
          '<div class="f"><label>期間類型 Period</label><select id="tgType">' +
            '<option value="day">日 Day</option><option value="week">週 Week</option>' +
            '<option value="month" selected>月 Month</option><option value="year">年 Year</option>' +
          '</select></div>' +
          '<div class="f"><label>選擇期間 Select period</label><input id="tgAnchor" list="tgKnown" type="date"><datalist id="tgKnown"></datalist></div>' +
          scopeHtml +
        '</div>' +
        '<div class="f" style="margin-top:10px"><label>訊息語言 Language</label><select id="tgLang">' + langHtml +
        '</select></div>' +
        '<div class="f" style="margin-top:10px"><label>訊息預覽 Preview</label>' +
          '<pre id="tgPreview" style="white-space:pre-wrap;max-height:330px;overflow:auto;background:#f6f8fb;border:1px solid var(--line);border-radius:9px;padding:11px;font:12px/1.55 system-ui,sans-serif"></pre></div>' +
        '<p id="tgNote" class="hint" style="margin-top:8px">摘要只是通知，不會改變資料狀態。</p>' +
      '</div>' +
      '<div class="mf"><button class="btn gray" data-tg-close>取消 Cancel</button>' +
        '<button class="btn" id="tgSend">✈️ 確認傳送 Send</button></div>' +
    '</div>';
  document.body.appendChild(mask);
  var q = function (s) { return mask.querySelector(s); };
  var close = function () { mask.remove(); };
  mask.querySelectorAll('[data-tg-close]').forEach(function (b) { b.onclick = close; });
  mask.onclick = function (e) { if (e.target === mask) close(); };
  q('#tgType').value = firstType;
  q('#tgLang').value = st.lang;
  if (q('#tgScope')) q('#tgScope').value = st.scope;

  function currentKey() {
    return opt.currentPeriod ? opt.currentPeriod(st.ptype) : new Period(st.ptype).key();
  }
  function anchorValue(key, type) {
    var a = tgAnchor(key, type), p = new Period(type, a), r = p.range();
    if (type === 'month') return a.getFullYear() + '-' + p2(a.getMonth() + 1);
    if (type === 'year') return String(a.getFullYear());
    return r.from;
  }
  function fillPeriods(reset) {
    var current = String(currentKey() || new Period(st.ptype).key());
    if (reset || !st.period || (st.ptype === 'month' && !/^\d{4}-\d{2}$/.test(st.period)) ||
        (st.ptype === 'year' && !/^\d{4}$/.test(st.period)) ||
        (st.ptype !== 'month' && st.ptype !== 'year' && !/^\d{4}-\d{2}-\d{2}$/.test(st.period))) st.period = current;
    var inp = q('#tgAnchor');
    inp.type = st.ptype === 'month' ? 'month' : st.ptype === 'year' ? 'number' : 'date';
    if (st.ptype === 'year') { inp.min = '2000'; inp.max = '2100'; inp.step = '1'; }
    else { inp.removeAttribute('min'); inp.removeAttribute('max'); inp.removeAttribute('step'); }
    inp.value = anchorValue(st.period, st.ptype);
    try {
      var list = opt.periods ? (opt.periods(st.ptype) || []) : [];
      q('#tgKnown').innerHTML = Array.from(new Set(list.map(String))).filter(Boolean).sort().reverse().map(function (k) {
        return '<option value="' + esc(anchorValue(k, st.ptype)) + '" label="' + esc(tgPeriodLabel(k, st.ptype)) + '">';
      }).join('');
    } catch (e) { q('#tgKnown').innerHTML = ''; }
  }
  function readAnchor() {
    var v = q('#tgAnchor').value;
    if (st.ptype === 'year') return String(parseInt(v, 10) || new Date().getFullYear());
    if (st.ptype === 'month') return /^\d{4}-\d{2}$/.test(v) ? v : currentKey();
    var d = parseD(v) || new Date();
    return new Period(st.ptype, d).key();
  }
  function note() {
    q('#tgNote').textContent = st.mode === 'approval'
      ? '只會送出尚未送核的 Security Fee；Telegram 群組會顯示逐筆核可／退件、翻頁、全部核可及關閉批次按鈕。'
      : '摘要是通知用途，可重複傳送，不會建立核可批次，也不會改變資料狀態。';
  }
  function summaryPages() {
    function one(s) {
      var v = opt.summaryPages ? opt.summaryPages(s) : (opt.summary ? opt.summary(s) : '（沒有摘要內容）');
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      return [String(v || '（本期間沒有資料）')];
    }
    if (st.lang !== 'both') return one(st);
    var zh = one(Object.assign({}, st, { lang:'zh' }));
    var en = one(Object.assign({}, st, { lang:'en' }));
    var n = Math.max(zh.length, en.length), out = [];
    for (var i = 0; i < n; i++) {
      out.push((zh[i] || '（本頁沒有中文資料）') + '\n\n──────── English / English ────────\n' +
        (en[i] || '（No English data on this page）'));
    }
    return out;
  }
  function preview() {
    var text = '';
    try {
      if (st.mode === 'approval') {
        var items = opt.approvalItems ? (opt.approvalItems(st) || []) : [];
        var amt = items.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
        text = '💰 保安費核可請求\n期間：' + tgPeriodLabel(st.period, st.ptype) +
          '\n─────────────\n筆數：' + items.length + '　合計：$' + amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) +
          '\n\n' + items.slice(0, 10).map(function (r, i) {
            return (i + 1) + '. ' + (r.name || r.item || '—') + ' · $' + Number(r.amount || 0).toFixed(2) +
              (r.reason ? '\n   ' + r.reason : '');
          }).join('\n') + (items.length > 10 ? '\n… 另有 ' + (items.length - 10) + ' 筆' : '');
        q('#tgSend').disabled = !items.length;
      } else {
        var pages = summaryPages();
        text = pages.length > 1 ? pages.map(function (x, i) { return '【' + (i + 1) + '/' + pages.length + '】\n' + x; }).join('\n\n') : pages[0];
        q('#tgSend').disabled = false;
      }
    } catch (e) { text = '⚠️ ' + e.message; q('#tgSend').disabled = true; }
    /* Telegram uses HTML markup; render the same markup in the preview so tags such as <b> do not appear as raw text. */
    q('#tgPreview').innerHTML = text;
  }
  q('#tgType').onchange = function () { st.ptype = this.value; fillPeriods(true); preview(); };
  q('#tgAnchor').onchange = function () { st.period = readAnchor(); preview(); };
  q('#tgLang').onchange = function () { st.lang = this.value; preview(); };
  if (q('#tgScope')) q('#tgScope').onchange = function () { st.scope = this.value; preview(); };
  mask.querySelectorAll('[data-tg-mode]').forEach(function (b) {
    b.onclick = function () {
      st.mode = b.dataset.tgMode;
      mask.querySelectorAll('[data-tg-mode]').forEach(function (x) { x.classList.toggle('on', x === b); });
      note(); preview();
    };
  });
  q('[data-tg-mode="summary"]').classList.add('on');
  q('#tgSend').onclick = async function () {
    var btn = this; btn.disabled = true; btn.textContent = '⏳ 傳送中…';
    try {
      if (st.mode === 'summary') {
        var pages = summaryPages();
        for (var pi = 0; pi < pages.length; pi++) {
          var pageText = pages.length > 1 ? '【' + (pi + 1) + '/' + pages.length + '】\n' + pages[pi] : pages[pi];
          var pagePhotos = [];
          if (typeof opt.summaryPhotos === 'function') {
            pagePhotos = opt.summaryPhotos(st, pi, pages.length, pageText) || [];
            if (!Array.isArray(pagePhotos)) pagePhotos = [pagePhotos];
            pagePhotos = pagePhotos.filter(Boolean).slice(0, 4);
          }
          await gasPost({ action:'telegram', text:pageText, module:opt.module||'', lang:st.lang,
            mode:'summary', period:st.period, periodType:st.ptype,
            photo:pagePhotos[0] || '', photos:pagePhotos });
        }
        scheduleAutoCloudSync(opt.module || '', 'telegram-summary', st.period || '');
        toast('✈️ Telegram 摘要已送出' + (pages.length > 1 ? '（' + pages.length + ' 頁）' : ''), 'ok');
      } else {
        var items = opt.approvalItems ? (opt.approvalItems(st) || []) : [];
        var result = await sendApproval({ module:opt.module, period:st.period, title:opt.approvalTitle || '', route:opt.route,
          lang:st.lang === 'both' ? 'zh' : st.lang, items:items });
        if (!result) throw new Error('核可請求未送出');
        if (opt.onApprovalSent) opt.onApprovalSent(result, st, items);
      }
      close();
    } catch (e) {
      toast('❌ ' + e.message, 'err', 6000);
      btn.disabled = false; btn.textContent = '✈️ 確認傳送 Send';
    }
  };
  q('#tgType').value = firstType;
  fillPeriods(); note(); preview();
  return { close:close };
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
    lang   : opt.lang || _lang,
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
    scheduleAutoCloudSync(opt.module || '', 'approval-request', opt.period || '');
    return r;
  } catch (e) { toast('❌ 送出失敗：' + e.message, 'err', 6000); return null; }
}

/* ───────── 照片（壓縮成 dataURL，免後端） ───────── */
function pickPhoto(cb, maxW, maxCount) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = function () {
    Array.prototype.slice.call(inp.files || [], 0, maxCount || 4).forEach(function (f) {
      compressImage(f, maxW || 760, cb);
    });
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
      /* 舊式 .xls 的日期可能回傳 Excel 序號，也可能直接回傳 Date；兩種都保留。 */
      var wb = XLSX.read(new Uint8Array(e.target.result), {
        type:'array', cellDates:true, cellNF:true, dateNF:'yyyy-mm-dd hh:mm:ss', raw:true
      });
      var sheets = wb.SheetNames.map(function (n) {
        return { name:n, fileName:file.name || '', rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true, blankrows:false }) };
      });
      cb(sheets, wb);
    } catch (err) {
      var em = String(err && err.message || err);
      var hint = /zip|central directory|end of central|eof|corrupt|invalid/i.test(em)
        ? '；檔案可能缺少 Excel ZIP 索引或已損壞，請從原始 Excel 另存新檔後再上傳'
        : '。請重新整理後再試';
      toast('❌ Excel 讀取失敗：' + em + hint, 'err', 9000);
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
        '<button class="ic-btn" id="btnSmart" title="智慧匯入 Smart Import">📥</button>' +
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
  var si = document.getElementById('btnSmart');
  if (si && typeof handlers.onSmartImport === 'function') {
    si.onclick = function (ev) {
      try {
        var out = handlers.onSmartImport(ev);
        if (out && typeof out.catch === 'function') out.catch(function (e) { bootError(e); });
      } catch (e) { bootError(e); }
    };
  } else if (si) si.style.display = 'none';
  bindAction('btnTg', handlers.onTelegram);
  var cf = document.getElementById('btnCfg');  if (cf)   cf.onclick   = openSettings;
  dataReady().then(function () { setLang(getCfg().lang || 'zh'); }).catch(function (e) { bootError(e); });
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
      '<p class="hint" id="cfgStorage" style="margin-top:6px">正在檢查本機資料儲存空間…</p>' +
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
  storageEstimate().then(function (s) {
    var el = document.getElementById('cfgStorage'); if (!el) return;
    var u = Number(s.usage || 0), q = Number(s.quota || 0);
    el.textContent = q ? '本機資料用量 / Site data: ' + (u / 1048576).toFixed(1) + ' MB / ' + (q / 1048576).toFixed(1) + ' MB；大量資料已使用 IndexedDB。' : '本機資料已改用 IndexedDB 儲存。';
  }).catch(function () {});
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
  closest:closest, bootError:bootError, safeStorageGet:safeStorageGet, safeStorageSet:safeStorageSet,
  dataReady:dataReady, dbGet:dbGet, dbPut:dbPut, storageEstimate:storageEstimate,
  Period:Period, periodNavHtml:periodNavHtml, bindPeriodNav:bindPeriodNav,
  T:T, lang:lang, setLang:setLang, applyI18n:applyI18n, I18N:BASE_I18N,
  toast:toast, gasPost:gasPost, cloudPush:cloudPush, cloudPull:cloudPull,
  registerAutoUploader:registerAutoUploader, scheduleAutoCloudSync:scheduleAutoCloudSync,
  retryAutoCloudSync:retryAutoCloudSync,
  markSync:markSync, lastSync:lastSync, tgSummary:tgSummary, tgOpen:tgOpen,
  recordKey:recordKey, mergeRecords:mergeRecords, mergeObject:mergeObject,
  blankConflictsObject:blankConflictsObject, confirmBlankMerge:confirmBlankMerge,
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
