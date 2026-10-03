/* ═══════════════════════════════════════════════════════════════════════
   AC Security Platform — shared/sec-core.js  v1.0
   共用引擎：設定 / 三語 / 雲端同步 / 期間導覽 / 智慧 Excel 匯入匯出 /
             照片上傳 / Telegram / 核可送出（兩關 or 直送）
   ═══════════════════════════════════════════════════════════════════════ */
(function (G) {
'use strict';

/* ───────── 設定 ───────── */
var CFG_KEY = 'ac_sec_config';
/* 前端零設定：GAS 網址內建。Telegram Bot Token 只存在 GAS 指令碼屬性，前端絕不保存。 */
var DEFAULTS = {
  gasUrl  : 'https://script.google.com/macros/s/AKfycbyxBN_t2AfxTPQ3AYdt7Jxl3pNiJV17H1T0pub4SR8GBgDH47WnDn9JF556KSxUiIU-/exec',
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
var MEM_DATA = {};            /* IndexedDB 寫入失敗時的記憶體副本（本分頁有效） */
var IDB_FAIL_WARNED = false;
var HEADER_TOOL = '';

/* localStorage 滿時不能讓初始化中斷。只整理同步時間標記，絕不刪除業務資料。 */
function storageQuota(e) {
  var s = String(e && (e.name || e.message) || e || '').toLowerCase();
  return s.indexOf('quota') >= 0 || s.indexOf('storage') >= 0 || s.indexOf('exceed') >= 0;
}
function storageWarn() {
  if (STORAGE_WARNED) return;
  STORAGE_WARNED = true;
  try { toast(L('⚠️ 手機儲存空間已滿：新資料只暫存在這個分頁，請立即上傳雲端。',
    '⚠️ Phone storage is full: new data is kept only in this tab. Upload to the cloud now.',
    '⚠️ ទំហំផ្ទុកទូរស័ព្ទពេញ៖ ទិន្នន័យថ្មីនៅតែក្នុងផ្ទាំងនេះ។ សូមផ្ទុកឡើងពពកភ្លាមៗ។'), 'err', 0, uploadNowAction()); } catch (_) {}
}
/* IndexedDB 寫入失敗：資料保留在記憶體，持續提示直到使用者點掉，並提供立即上傳。 */
function idbWriteWarn() {
  if (IDB_FAIL_WARNED) return;
  IDB_FAIL_WARNED = true;
  try {
    toast(L('⚠️ 未儲存到手機，請立即上傳雲端', '⚠️ Not saved on this phone. Upload to the cloud now.',
      '⚠️ មិនបានរក្សាទុកក្នុងទូរស័ព្ទទេ។ សូមផ្ទុកឡើងពពកភ្លាមៗ។'), 'err', 0, uploadNowAction());
    G.dispatchEvent(new CustomEvent('ac-sec-storage-fail'));
  } catch (_) {}
}
function uploadNowAction() {
  if (!HEADER_TOOL || !SEC_AUTO_UPLOADERS[HEADER_TOOL]) return null;
  return { label: L('⬆️ 立即上傳', '⬆️ Upload now', '⬆️ ផ្ទុកឡើងឥឡូវ'), fn: function () { manualCloudSync(HEADER_TOOL, 'upload'); } };
}
function validGasUrl(u) { return /^https:\/\/[^\s"'<>]+$/i.test(String(u == null ? '' : u).trim()); }
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
    /* 空白或無效網址一律回到內建預設，使用者永遠不需要貼網址。 */
    gasUrl: validGasUrl(c.gasUrl) ? String(c.gasUrl).trim().slice(0, 1000) : DEFAULTS.gasUrl,
    tgChat: c.tgChat == null || String(c.tgChat).trim() === '' ? DEFAULTS.tgChat : String(c.tgChat).trim().slice(0, 120),
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
function idbKeys(db) {
  return new Promise(function (resolve, reject) {
    var store = db.transaction([DATA_DB_STORE], 'readonly').objectStore(DATA_DB_STORE), out = [];
    if (store.getAllKeys) {
      var r = store.getAllKeys();
      r.onsuccess = function () { resolve((r.result || []).map(String)); };
      r.onerror = function () { reject(r.error); };
      return;
    }
    var c = store.openCursor();
    c.onsuccess = function () { var cur = c.result; if (cur) { out.push(String(cur.key)); cur.continue(); } else resolve(out); };
    c.onerror = function () { reject(c.error); };
  });
}
/* 從設定中移除任何舊版留下的 Telegram Bot Token（安全性）。 */
function purgeSecrets() {
  [function () { return G.localStorage; }, function () { return G.sessionStorage; }].forEach(function (get) {
    try {
      var s = get(), raw = s && s.getItem(CFG_KEY); if (!raw) return;
      var o = JSON.parse(raw);
      if (o && typeof o === 'object' && ('tgToken' in o || 'botToken' in o)) {
        delete o.tgToken; delete o.botToken;
        s.setItem(CFG_KEY, JSON.stringify(o));
      }
    } catch (_) {}
  });
}
purgeSecrets();
function migrateLegacyData() {
  return openDataDb().then(function (db) {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        /* 刪除紀錄帳本由 loadDeletedLedger() 以「合併」方式搬移，不可在此覆蓋。 */
        if (k && (/^ac_sec_/.test(k) || /^(vrt_truck_v2|vr-container-inspections|vrt_v2)$/.test(k)) && k !== CFG_KEY &&
            !/^ac_sec_sync_/.test(k) && !/^ac_sec_auto_sync_/.test(k) && !/^ac_sec_smart_sync_/.test(k) && k.indexOf(DELETED_KEY) !== 0) keys.push(k);
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
var PERSIST_ASKED = false;
function requestPersist() {
  /* 請瀏覽器把本站資料標為「持久保存」，降低手機自動清除的機率。只呼叫一次。 */
  if (PERSIST_ASKED) return;
  PERSIST_ASKED = true;
  try {
    var st = G.navigator && G.navigator.storage;
    if (st && st.persist) {
      var p = st.persisted ? st.persisted() : Promise.resolve(false);
      p.then(function (yes) { if (!yes) return st.persist(); }).catch(function () {});
    }
  } catch (_) {}
}
function dataReady() {
  if (!DATA_READY) {
    requestPersist();
    DATA_READY = migrateLegacyData().then(function (ok) {
      return loadDeletedLedger().then(function () { return ok; }, function () { return ok; });
    });
  }
  return DATA_READY;
}
function legacyValue(key, fallback) {
  var raw = safeStorageGet(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}
function dbGet(key, fallback) {
  /* 寫入失敗而留在記憶體的最新資料優先，避免重新讀到較舊的 IndexedDB 內容。 */
  if (Object.prototype.hasOwnProperty.call(MEM_DATA, key)) return Promise.resolve(MEM_DATA[key]);
  return dataReady().then(function () {
    if (Object.prototype.hasOwnProperty.call(MEM_DATA, key)) return MEM_DATA[key];
    return openDataDb().then(function (db) { return idbGet(db, key); }).then(function (v) {
      return v === undefined ? legacyValue(key, fallback) : v;
    });
  }).catch(function () { return legacyValue(key, fallback); });
}
function dbPut(key, value) {
  var q = DATA_QUEUE[key] || Promise.resolve();
  DATA_QUEUE[key] = q.then(function () {
    return openDataDb().then(function (db) {
      return idbPut(db, key, value).then(function () {
        delete MEM_DATA[key];
        return true;
      }, function (err) {
        /* IndexedDB 存在但寫入失敗（多半是空間不足）：不要偷偷改存 localStorage
           （下次讀取仍會優先讀 IndexedDB 舊資料）。保留記憶體副本並持續提示上傳。 */
        MEM_DATA[key] = value;
        try { console.warn('[AC SEC] IndexedDB write failed', key, err); } catch (_) {}
        idbWriteWarn();
        return false;
      });
    }, function () {
      /* 這個瀏覽器完全沒有 IndexedDB（例如部分隱私模式）：dbGet 也會讀 localStorage，
         因此這裡改存 localStorage 是一致的；若 localStorage 也失敗才進記憶體並提示。 */
      if (safeStorageSet(key, JSON.stringify(value)) && !STORAGE_WARNED) { delete MEM_DATA[key]; return true; }
      MEM_DATA[key] = value;
      idbWriteWarn();
      return false;
    });
  }).catch(function () { MEM_DATA[key] = value; idbWriteWarn(); return false; });
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
/* Excel 序號（1900 系統）→ 本地日期。只用 UTC 計算日曆日，再以本地建構，
   不受時區（例如 Asia/Phnom_Penh）影響；加半秒容忍浮點誤差。 */
function excelSerialDate(v) {
  var whole = Math.floor(v + 0.5 / 86400);
  var d0 = new Date(Date.UTC(1899, 11, 30) + whole * 86400000);
  return new Date(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
}
function isSerialNumber(v) { return typeof v === 'number' && isFinite(v) && v > 20000 && v < 60000; }
function parseD(v) {
  if (v === null || v === undefined || v === '' || v === 0) return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    /* 舊版 cellDates 讀出的 Date 可能早幾秒（例如 23:59:56）；四捨五入到分鐘再取日期。 */
    return new Date(Math.round(v.getTime() / 60000) * 60000);
  }
  if (typeof v === 'number') {              /* Excel 序號（可含時間小數） */
    return isSerialNumber(v) ? excelSerialDate(v) : null;
  }
  var s = String(v).trim();
  if (!s) return null;
  var m;
  /* 純數字字串的 Excel 序號，例如 "46266" 或 "46266.354" */
  if (/^\d{5}(?:\.\d+)?$/.test(s)) { var sn = parseFloat(s); return isSerialNumber(sn) ? excelSerialDate(sn) : null; }
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
/* 時間 → 'HH:MM'。支援：Excel 時間小數（0.354 = 08:30）、日期＋時間序號（46266.354）、
   Date 物件、'8:30'、'08:30:15'、'8:30 PM'、'下午 3:05'、'0830'、'2026-09-01 08:30'。
   無法辨識時回傳空字串。小數一律 Math.round(frac*1440) 分鐘。 */
function parseTime(v) {
  if (v === null || v === undefined || v === '') return '';
  var mins;
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    var r = new Date(Math.round(v.getTime() / 60000) * 60000);
    return p2(r.getHours()) + ':' + p2(r.getMinutes());
  }
  if (typeof v === 'number') {
    if (!isFinite(v) || v < 0) return '';
    if (v === Math.floor(v) && v >= 1 && v < 2400 && v % 100 < 60) {   /* 830 / 1745 之類的 HHMM 數字 */
      return p2(Math.floor(v / 100)) + ':' + p2(v % 100);
    }
    mins = Math.round((v - Math.floor(v)) * 1440) % 1440;
    return p2(Math.floor(mins / 60)) + ':' + p2(mins % 60);
  }
  var s = String(v).trim();
  if (!s) return '';
  if (/^\d{5}$/.test(s)) return parseTime(parseFloat(s));
  if (/^\d*\.\d+$/.test(s)) { var f = parseFloat(s); if (f < 1 || f >= 20000) return parseTime(f); }  /* 8.30 → 下方 H.MM */
  if (/^\d{3,4}$/.test(s)) return parseTime(parseInt(s, 10));
  var pm = /(?:\bp\.?\s?m\.?\b|下午|晚上|ល្ងាច)/i.test(s), am = /(?:\ba\.?\s?m\.?\b|上午|早上|ព្រឹក)/i.test(s);
  /* 先找冒號格式（可跟在日期後面），再接受 8.30 / 8h30 這類短字串 */
  var m = s.match(/(?:^|[^\d])(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}(?:\.\d+)?))?/) ||
          (s.length <= 8 ? s.match(/^(\d{1,2})\s*[.hH時点]\s*(\d{2})/) : null);
  if (!m) {
    var onlyH = s.match(/^(\d{1,2})\s*(?:a\.?\s?m\.?|p\.?\s?m\.?|時|点)$/i);
    if (!onlyH) return '';
    m = [onlyH[0], onlyH[1], '00'];
  }
  var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h === 24 && mi === 0) h = 0;
  if (!(h >= 0 && h < 24 && mi >= 0 && mi < 60)) return '';
  return p2(h) + ':' + p2(mi);
}

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
       cloudOk:'ធ្វើសមកាលកម្មពពករួចរាល់',cloudFail:'ធ្វើសមកាលកម្មពពកបរាជ័យ',imported:'បាននាំចូល',records:'កំណត់ត្រា' },
};
var _lang = getCfg().lang || 'zh';
function T(lang) { return BASE_I18N[lang || _lang] || BASE_I18N.zh; }
function lang() { return _lang; }
/* 單一語言輸出：L('中文','English','ខ្មែរ')；km 缺值退回英文，en/km 模式絕不回中文。
   也可傳物件 L({zh:'',en:'',km:''})。 */
function L(zh, en, km) {
  if (zh && typeof zh === 'object') { km = zh.km; en = zh.en; zh = zh.zh; }
  if (_lang === 'en') return en != null && en !== '' ? String(en) : String(km || zh || '');
  if (_lang === 'km') return km != null && km !== '' ? String(km) : String(en != null && en !== '' ? en : (zh || ''));
  return String(zh != null && zh !== '' ? zh : (en || km || ''));
}
function setLang(l) {
  _lang = (['zh','en','km'].indexOf(l) >= 0) ? l : 'zh';
  setCfg({ lang: _lang });
  document.documentElement.lang = _lang === 'zh' ? 'zh-Hant' : (_lang === 'km' ? 'km' : 'en');
  document.querySelectorAll('.lang-sw .lb').forEach(function (b) {
    b.classList.toggle('on', b.dataset.l === _lang);
  });
  applyI18n(document);
  refreshHeaderText();
  if (G.onLangChange) try { G.onLangChange(_lang); } catch (e) {}
}
/* data-i18n="zh|en|km" 或 data-zh / data-en / data-km */
function applyI18n(root) {
  (root || document).querySelectorAll('[data-zh]').forEach(function (el) {
    var v = el.getAttribute('data-' + _lang) || (_lang === 'zh' ? '' : el.getAttribute('data-en')) || el.getAttribute('data-zh');
    if (v != null) { if (el.placeholder !== undefined && el.tagName === 'INPUT') el.placeholder = v; else el.textContent = v; }
  });
  (root || document).querySelectorAll('[data-t]').forEach(function (el) {
    var k = el.getAttribute('data-t'), v = T()[k];
    if (v) el.textContent = v;
  });
  /* 提示文字（title / aria-label）：data-tip-zh / data-tip-en / data-tip-km */
  (root || document).querySelectorAll('[data-tip-zh]').forEach(function (el) {
    var v = el.getAttribute('data-tip-' + _lang) || el.getAttribute('data-tip-en') || el.getAttribute('data-tip-zh');
    if (v != null) { el.title = v; el.setAttribute('aria-label', v); }
  });
}
function i18nAttrs(zh, en, km, prefix) {
  prefix = prefix || 'data-';
  return ' ' + prefix + 'zh="' + esc(zh) + '" ' + prefix + 'en="' + esc(en) + '" ' + prefix + 'km="' + esc(km || en) + '"';
}

/* ───────── Toast ───────── */
/* 提示訊息顯示在畫面上方，不會蓋住底部的「儲存／傳送」按鈕。
   錯誤（kind='err'）或 ms===0 會一直顯示，直到使用者點一下。
   action = { label, fn } 會在訊息內加一顆按鈕（例如「🔄 再試一次」）。 */
function toast(msg, kind, ms, action) {
  var w = document.getElementById('toastwrap');
  if (!w) { w = document.createElement('div'); w.id = 'toastwrap'; document.body.appendChild(w); }
  var sticky = kind === 'err' || ms === 0;
  var d = document.createElement('div');
  d.className = 'toast' + (kind ? ' ' + kind : '') + (sticky ? ' sticky' : '');
  d.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  d.innerHTML = '<span class="toast-msg">' + msg + '</span>';
  if (action && action.label && typeof action.fn === 'function') {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = function (ev) { ev.stopPropagation(); remove(); try { action.fn(); } catch (e) { bootError(e); } };
    d.appendChild(b);
  }
  if (sticky) {
    var x = document.createElement('span');
    x.className = 'toast-x'; x.setAttribute('aria-hidden', 'true'); x.textContent = '×';
    d.appendChild(x);
  }
  function remove() {
    if (!d.parentNode) return;
    d.style.transition = '.25s'; d.style.opacity = 0;
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 260);
  }
  d.onclick = remove;
  /* 同樣的訊息不要疊一堆 */
  Array.prototype.slice.call(w.children).forEach(function (o) {
    if (o !== d && o.querySelector && o.querySelector('.toast-msg') && o.querySelector('.toast-msg').innerHTML === d.querySelector('.toast-msg').innerHTML && o.parentNode) o.parentNode.removeChild(o);
  });
  while (w.children.length >= 4) w.removeChild(w.firstChild);
  w.appendChild(d);
  if (!sticky) setTimeout(remove, ms || 3000);
  return d;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ───────── GAS ───────── */
/* 白話錯誤訊息（三語），給保安看得懂，並說明下一步。 */
function netFailText() {
  return L('📴 沒有網路或雲端暫時連不上；資料已存在手機，稍後會自動上傳。可按「再試一次」。',
    '📴 No internet or the cloud is temporarily unreachable. Your data is saved on this phone and will upload automatically later. Tap "Try again" to retry.',
    '📴 គ្មានអ៊ីនធឺណិត ឬពពកមិនអាចភ្ជាប់បានបណ្តោះអាសន្ន។ ទិន្នន័យត្រូវបានរក្សាទុកក្នុងទូរស័ព្ទ ហើយនឹងផ្ទុកឡើងដោយស្វ័យប្រវត្តិពេលក្រោយ។ ចុច «ព្យាយាមម្តងទៀត»។');
}
function retryLabel() { return L('🔄 再試一次', '🔄 Try again', '🔄 ព្យាយាមម្តងទៀត'); }
function secError(message, code, detail) {
  var e = new Error(message); e.code = code || 'GAS'; if (detail) e.detail = detail; return e;
}
/* 暫時性錯誤（網路、逾時、伺服器忙碌）不應改走舊版完整上傳。 */
function isTransient(e) {
  if (!e) return false;
  if (e.code === 'NETWORK' || e.code === 'HTTP') return true;
  return /network|failed to fetch|timeout|timed out|load failed|service invoked too many|try again|busy|lock/i.test(String(e.message || e.detail || ''));
}
async function gasPost(payload) {
  var c = getCfg(), res;
  try {
    res = await fetch(c.gasUrl || DEFAULTS.gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw secError(netFailText(), 'NETWORK', String(e && e.message || e));
  }
  var raw = await res.text(), j;
  try { j = JSON.parse(raw); } catch (e) {
    if (/^\s*(?:<!doctype\s+html|<html|<head|<script)/i.test(raw)) {
      throw secError(L('☁️ 雲端服務目前無法使用（收到的是網頁，不是資料）。資料已存在手機；請通知管理員更新雲端部署。',
        '☁️ The cloud service is unavailable right now (it returned a web page, not data). Your data is saved on this phone; please tell the administrator to update the cloud deployment.',
        '☁️ សេវាពពកមិនអាចប្រើបានឥឡូវនេះ។ ទិន្នន័យត្រូវបានរក្សាទុកក្នុងទូរស័ព្ទ។ សូមជូនដំណឹងអ្នកគ្រប់គ្រង។'), 'DEPLOY', raw.slice(0, 200));
    }
    if (!res.ok) throw secError(netFailText(), 'HTTP', 'HTTP ' + res.status);
    throw secError(L('☁️ 雲端回覆格式錯誤，請稍後再試。', '☁️ The cloud sent an unexpected reply. Please try again later.',
      '☁️ ពពកឆ្លើយតបមិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀតពេលក្រោយ។'), 'FORMAT', raw.slice(0, 200));
  }
  if (!res.ok) throw secError(j.error || ('HTTP ' + res.status), 'HTTP');
  if (j && j.ok === false) throw secError(j.error || 'GAS error', 'GAS');
  return (j && j.data !== undefined) ? j.data : j;
}

/* ───────── HRA Pay 同步習慣：摘要／核可後自動上傳及失敗重試 ─────────
   只在 localStorage 留一個很小的待辦標記；實際資料仍由各模組的
   doUpload() 讀取，避免把整份資料塞進瀏覽器儲存空間。 */
var SEC_AUTO_UPLOADERS = {}, SEC_AUTO_DOWNLOADERS = {}, SEC_AUTO_TIMERS = {}, SEC_AUTO_BUSY = {}, SEC_AUTO_AGAIN = {};
var SEC_REPORT_TIMERS = {};
function registerAutoUploader(tool, fn) {
  if (tool && typeof fn === 'function') SEC_AUTO_UPLOADERS[String(tool)] = fn;
}
function registerAutoDownloader(tool, fn) {
  if (tool && typeof fn === 'function') SEC_AUTO_DOWNLOADERS[String(tool)] = fn;
}
function autoSyncKey(tool) { return 'ac_sec_auto_sync_' + String(tool || ''); }
function syncTime() {
  try { return new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false }); }
  catch (e) { return ''; }
}
function autoSyncDelay(reason, requested) {
  var r = String(reason || '').toLowerCase();
  var d = requested == null ? 900 : Number(requested);
  if (!isFinite(d) || d < 0) d = 900;
  /* HRA Pay reliability rule: imports and user-facing commits must start
     before a mobile tab can be suspended. Ordinary edits stay debounced. */
  if (/(?:import|telegram|approval|review|restore|file-change|file-delete|summary-sent|approval-sent)/.test(r)) return Math.min(d, 60);
  if (/(?:batch-save|batch-delete|bulk-delete)/.test(r)) return Math.min(d, 250);
  return d;
}
/* 雲端狀態文字（單一語言）。紅色＝離線或未上雲；綠色只在成功往返雲端之後。 */
var SYNC_TEXT = {
  idle:    ['☁ 自動同步', '☁ Auto sync', '☁ ធ្វើសមកាលកម្មស្វ័យប្រវត្តិ'],
  dirty:   ['☁ 待上傳', '☁ Waiting to upload', '☁ រង់ចាំផ្ទុកឡើង'],
  syncing: ['☁ 同步中…', '☁ Syncing…', '☁ កំពុងធ្វើសមកាលកម្ម…'],
  synced:  ['✅ 已上雲', '✅ Saved to cloud', '✅ បានរក្សាទុកក្នុងពពក'],
  checked: ['✅ 雲端已檢查', '✅ Cloud checked', '✅ បានពិនិត្យពពក'],
  offline: ['📴 離線／未上雲', '📴 Offline / not in cloud', '📴 គ្មានអ៊ីនធឺណិត / មិនទាន់ដាក់ពពក'],
  retry:   ['📴 離線／未上雲', '📴 Offline / not in cloud', '📴 គ្មានអ៊ីនធឺណិត / មិនទាន់ដាក់ពពក'],
};
var SYNC_LAST = { tool:'', state:'idle', detail:'' };
function autoSyncText(state, detail) {
  var t = SYNC_TEXT[state] || SYNC_TEXT.idle;
  var s = L(t[0], t[1], t[2]);
  return (state === 'synced' || state === 'checked') && detail ? s + ' ' + detail : s;
}
function syncBusyAny() {
  return Object.keys(SEC_AUTO_BUSY).some(function (k) { return !!SEC_AUTO_BUSY[k]; });
}
function paintSyncButtons() {
  var busy = syncBusyAny();
  ['btnUp', 'btnDown'].forEach(function (id) {
    var b = document.getElementById(id); if (!b) return;
    b.disabled = busy; b.classList.toggle('busy', busy);
    b.setAttribute('aria-busy', busy ? 'true' : 'false');
  });
}
function setAutoSyncState(tool, state, detail) {
  SYNC_LAST = { tool:String(tool || ''), state:state || 'idle', detail:detail || '' };
  var el = document.querySelector('.c-state'), dot = document.querySelector('.c-dot');
  var red = state === 'offline' || state === 'retry';
  if (el) {
    el.textContent = autoSyncText(state, detail || '');
    el.className = 'c-state ' + (state || 'idle');
    el.title = autoSyncText(state, detail || '');
  }
  if (dot) {
    dot.className = 'c-dot' + (state === 'syncing' ? ' syncing' : state === 'synced' || state === 'checked' ? ' ok' : red ? ' err' : '');
  }
  var bar = document.getElementById('cloudBar');
  if (bar) bar.classList.toggle('offline', red);
  paintSyncButtons();
  try { G.dispatchEvent(new CustomEvent('ac-sec-autosync-state', { detail:{ tool:String(tool || ''), state:state, detail:detail || '', at:Date.now() } })); } catch (e) {}
}
/* 單筆紀錄的同步標籤：'local'（只在手機）／'cloud'（已上雲）／'telegram'（已發群組）／'pending'（待核）。 */
function syncBadge(state) {
  var map = {
    local:    ['gray', '📱 本機', '📱 This phone', '📱 ទូរស័ព្ទនេះ'],
    cloud:    ['ok',   '☁️ 已上雲', '☁️ In cloud', '☁️ ក្នុងពពក'],
    telegram: ['info', '✈️ 已發群組', '✈️ Sent to group', '✈️ បានផ្ញើទៅក្រុម'],
    pending:  ['warn', '⏳ 待核可', '⏳ Awaiting approval', '⏳ រង់ចាំការអនុម័ត'],
    offline:  ['err',  '📴 未上雲', '📴 Not in cloud', '📴 មិនទាន់ដាក់ពពក'],
  };
  var m = map[state] || map.local;
  return '<span class="tag ' + m[0] + ' sync-badge">' + esc(L(m[1], m[2], m[3])) + '</span>';
}
function refreshHeaderText() {
  if (SYNC_LAST.tool || HEADER_TOOL) setAutoSyncState(SYNC_LAST.tool || HEADER_TOOL, SYNC_LAST.state, SYNC_LAST.detail);
  var menu = document.getElementById('secMoreMenu'); if (menu) menu.hidden = true;
}
function reportPeriod(period) {
  var m = String(period || '').match(/^(\d{4}-\d{2})(?:-(\d{2}))?/);
  return m ? (m[2] ? m[1] + '-' + m[2] : m[1]) : '';
}
function shouldTrackReportUpdate(reason) {
  return !/(?:telegram|approval|startup|resume|network|retry|queued|repair|cloud)/i.test(String(reason || ''));
}
/* Register the business date that was actually edited. GAS applies the
   previous-month cutoff, so an August edit to June data is intentionally
   ignored. The client timestamp prevents a later background upload from
   reopening a reminder after the corresponding summary was already sent. */
function queueReportUpdate(tool, reason, period, updateAt) {
  if (!tool || !shouldTrackReportUpdate(reason)) return;
  /* A reminder must come from an actual dated/monthly operation record.
     Camera/equipment/driver master IDs are not business periods and must not
     silently become "today"; that old fallback produced false reminders. */
  period = reportPeriod(period);
  if (!period) return;
  var key = String(tool) + '|' + period;
  clearTimeout(SEC_REPORT_TIMERS[key]);
  SEC_REPORT_TIMERS[key] = setTimeout(function () {
    delete SEC_REPORT_TIMERS[key];
    gasPost({ action:'reportUpdate', tool:String(tool), period:period,
      reason:String(reason || 'update'), updateAt:Number(updateAt) || Date.now(),
      needApproval:String(tool) === 'expense' && /security[-_ ]?fee/i.test(String(reason || '')) })
      .catch(function (e) { console.warn('[AC SEC report reminder]', tool, period, e); });
  }, 120);
}
/* 每次同步回合的網路結果：只有真的與雲端往返成功，狀態才可以變綠色。 */
var SEC_NET = {}, SEC_LAST_RUN = {}, RESUME_GAP_MS = 5 * 60 * 1000;
function noteNet(tool, ok, err) {
  SEC_NET[String(tool || '')] = { ok:!!ok, at:Date.now(), error:err ? String(err.message || err) : '', code:err && err.code || '' };
}
function netState(tool) { return SEC_NET[String(tool || '')] || null; }
async function runAutoCloudSync(tool, marker) {
  tool = String(tool || '');
  if (!tool) return false;
  if (SEC_AUTO_BUSY[tool]) {
    /* 同一模組不允許兩個同步同時進行；結束後再跑一次。 */
    if (!(marker && marker.manual)) SEC_AUTO_AGAIN[tool] = marker || { reason:'queued', period:'' };
    return false;
  }
  if (!navigator.onLine) {
    setAutoSyncState(tool, 'offline');
    return false;
  }
  var push = SEC_AUTO_UPLOADERS[tool], pull = SEC_AUTO_DOWNLOADERS[tool];
  if (typeof push !== 'function') return false;
  var priorPending = null, reason = (marker && marker.reason) || 'background-reconcile', manual = !!(marker && marker.manual);
  try { priorPending = localStorage.getItem(autoSyncKey(tool)); } catch (e) {}
  SEC_AUTO_BUSY[tool] = true;
  SEC_LAST_RUN[tool] = Date.now();
  delete SEC_NET[tool];
  SEC._autoSyncSilent = true;
  setAutoSyncState(tool, 'syncing');
  var opts = { silent:true, auto:true, manual:manual, reason:reason, period:(marker && marker.period) || '' };
  try {
    /* HRA Portal style: local data opens first, then changed cloud buckets are
       reconciled before changed local buckets are committed. */
    if (typeof pull === 'function') await pull({ silent:true, auto:true, manual:manual, reason:reason });
    var pullNet = netState(tool);
    var ok = pullNet && pullNet.ok === false ? false : await push(opts);
    /* 上傳時若併入了別台裝置的雲端資料，頁面本機還沒有這些資料：立即再下載一次。 */
    var st = typeof SEC.smartSyncState === 'function' ? SEC.smartSyncState(tool) : null;
    if (ok !== false && st && st.needsPull && typeof pull === 'function') await pull({ silent:true, auto:true, manual:manual, reason:'post-merge' });
    var net = netState(tool), netOk = !!(net && net.ok), netFail = !!(net && net.ok === false);
    if (ok !== false && !netFail) {
      try { localStorage.removeItem(autoSyncKey(tool)); } catch (e) {}
      if (netOk) { markSync(tool); setAutoSyncState(tool, 'synced', syncTime()); }
      else setAutoSyncState(tool, 'idle');
      return true;
    }
    if (ok === false && netOk && !priorPending && /^(?:startup-reconcile|reconcile|resume|page-resume|app-resume|network-restored)$/.test(reason)) {
      /* A passive startup check on a new/empty module is not a failed upload. */
      try { localStorage.removeItem(autoSyncKey(tool)); } catch (e) {}
      setAutoSyncState(tool, 'checked', syncTime());
      return false;
    }
    try { safeStorageSet(autoSyncKey(tool), JSON.stringify(marker || { tool:tool, reason:'retry', period:'', at:Date.now() })); } catch (e) {}
    setAutoSyncState(tool, 'retry');
    return false;
  } catch (e) {
    console.warn('[AC SEC auto sync]', tool, e);
    noteNet(tool, false, e);
    try { safeStorageSet(autoSyncKey(tool), JSON.stringify(marker || { tool:tool, reason:'retry', period:'', at:Date.now() })); } catch (_) {}
    setAutoSyncState(tool, 'retry');
    return false;
  } finally {
    SEC._autoSyncSilent = false;
    SEC_AUTO_BUSY[tool] = false;
    paintSyncButtons();
    if (SEC_AUTO_AGAIN[tool]) {
      var again = SEC_AUTO_AGAIN[tool]; delete SEC_AUTO_AGAIN[tool];
      scheduleAutoCloudSync(tool, again.reason || 'queued', again.period || '', undefined, again.at);
    }
  }
}
/* 頁首 ⬆️／⬇️：走同一個同步流程（有忙碌鎖），執行中按鈕反灰，完成後給一個清楚結果。 */
async function manualCloudSync(tool, kind) {
  tool = String(tool || HEADER_TOOL || '');
  if (!tool || typeof SEC_AUTO_UPLOADERS[tool] !== 'function') return null;
  if (SEC_AUTO_BUSY[tool]) {
    toast(L('⏳ 正在同步，請稍候…', '⏳ Sync in progress, please wait…', '⏳ កំពុងធ្វើសមកាលកម្ម សូមរង់ចាំ…'), 'warn', 3000);
    return false;
  }
  clearTimeout(SEC_AUTO_TIMERS[tool]);
  var retry = { label:retryLabel(), fn:function () { manualCloudSync(tool, kind); } };
  if (!navigator.onLine) {
    setAutoSyncState(tool, 'offline');
    toast(netFailText(), 'err', 0, retry);
    return false;
  }
  var ok = await runAutoCloudSync(tool, { tool:tool, reason:kind === 'download' ? 'manual-download' : 'manual-upload', period:'', at:Date.now(), manual:true });
  if (ok) toast(L('✅ 已與雲端同步', '✅ Synced with the cloud', '✅ បានធ្វើសមកាលកម្មជាមួយពពក'), 'ok', 3500);
  else {
    var net = netState(tool);
    toast(net && net.ok === false && net.code !== 'NETWORK' && net.error ? esc(net.error) : netFailText(), 'err', 0, retry);
  }
  return ok;
}
function scheduleAutoCloudSync(tool, reason, period, delay, updateAt) {
  tool = String(tool || ''); if (!tool) return;
  /* Keep the original business-update timestamp across retry/reload. A retry
     is transport work, not a new edit, and must never reopen a sent reminder. */
  var marker = { tool:tool, reason:String(reason || 'event'), period:String(period || ''), at:Number(updateAt) || Date.now() };
  queueReportUpdate(tool, marker.reason, marker.period, marker.at);
  try { safeStorageSet(autoSyncKey(tool), JSON.stringify(marker)); } catch (e) {}
  setAutoSyncState(tool, navigator.onLine ? 'dirty' : 'offline');
  clearTimeout(SEC_AUTO_TIMERS[tool]);
  SEC_AUTO_TIMERS[tool] = setTimeout(function () { runAutoCloudSync(tool, marker); }, autoSyncDelay(marker.reason, delay));
}
function retryAutoCloudSync(tool) {
  tool = String(tool || ''); if (!tool) return;
  var raw = null;
  try { raw = localStorage.getItem(autoSyncKey(tool)); } catch (e) {}
  if (!raw) return false;
  var m = {}; try { m = JSON.parse(raw) || {}; } catch (e) {}
  scheduleAutoCloudSync(tool, m.reason || 'retry', m.period || '', 180, m.at);
  return true;
}
function startAutoCloudSync(tool) {
  tool = String(tool || ''); if (!tool) return;
  if (!retryAutoCloudSync(tool)) setTimeout(function () { runAutoCloudSync(tool, { tool:tool, reason:'startup-reconcile', period:'', at:Date.now() }); }, 350);
}
/* 切回 App／網路恢復時的自動同步：每個模組最多 5 分鐘一次（手動按鈕不受限）。
   有「未上傳」標記且是網路恢復時，立即重試，避免資料只留在手機。 */
function resumeAllAutoCloudSync(reason) {
  if (!navigator.onLine) return;
  var now = Date.now();
  Object.keys(SEC_AUTO_UPLOADERS).forEach(function (tool) {
    var pending = null;
    try { pending = localStorage.getItem(autoSyncKey(tool)); } catch (e) {}
    var recent = now - (SEC_LAST_RUN[tool] || 0) < RESUME_GAP_MS;
    if (recent && !(pending && reason === 'network-restored')) return;
    if (!retryAutoCloudSync(tool)) setTimeout(function () { runAutoCloudSync(tool, { tool:tool, reason:reason || 'resume', period:'', at:Date.now() }); }, 180);
  });
}
G.addEventListener('online', function () { resumeAllAutoCloudSync('network-restored'); });
G.addEventListener('offline', function () { if (SYNC_LAST.tool || HEADER_TOOL) setAutoSyncState(SYNC_LAST.tool || HEADER_TOOL, 'offline'); });
G.addEventListener('pageshow', function (e) { if (e.persisted) resumeAllAutoCloudSync('page-resume'); });
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) resumeAllAutoCloudSync('app-resume');
});
function autoSyncDebug() {
  return { busy:Object.assign({}, SEC_AUTO_BUSY), lastRun:Object.assign({}, SEC_LAST_RUN), net:JSON.parse(JSON.stringify(SEC_NET)), resumeGapMs:RESUME_GAP_MS };
}

/* 雲端上傳（舊版完整 JSON，分塊）—— 只在後端沒有智慧同步端點時使用 */
async function cloudPush(tool, records, summary, extra) {
  var dot = document.querySelector('.c-dot'); if (dot) dot.className = 'c-dot syncing';
  setAutoSyncState(tool, 'syncing');
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
      if (result && result.keptExisting && !SEC._autoSyncSilent) toast(L('ℹ️ 雲端原有較完整的資料，已合併保留，沒有刪除任何資料。',
        'ℹ️ The cloud had more complete data; it was merged and kept. Nothing was deleted.',
        'ℹ️ ពពកមានទិន្នន័យពេញលេញជាង បានបញ្ចូលគ្នា និងរក្សាទុក។ គ្មានអ្វីត្រូវបានលុបទេ។'), 'warn', 5000);
    }
    noteNet(tool, true);
    markSync(tool);
    if (dot) dot.className = 'c-dot ok';
    setAutoSyncState(tool, 'synced', syncTime());
    if (!SEC._autoSyncSilent) toast('⬆️☁ ' + T().cloudOk + ' (' + (records||[]).length + ' ' + T().records + ')', 'ok');
    return true;
  } catch (e) {
    noteNet(tool, false, e);
    if (dot) dot.className = 'c-dot err';
    setAutoSyncState(tool, 'retry');
    if (!SEC._autoSyncSilent) toast('❌ ' + T().cloudFail + ': ' + esc(e.message), 'err', 0);
    return false;
  }
}
/* 雲端下載（舊版完整 JSON） */
async function cloudPull(tool, opts) {
  var dot = document.querySelector('.c-dot'); if (dot) dot.className = 'c-dot syncing';
  setAutoSyncState(tool, 'syncing');
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
    noteNet(tool, true);
    if (dot) dot.className = 'c-dot ok';
    setAutoSyncState(tool, 'synced', syncTime());
    return recs;
  } catch (e) {
    noteNet(tool, false, e);
    if (dot) dot.className = 'c-dot err';
    setAutoSyncState(tool, 'retry');
    if (!SEC._autoSyncSilent) toast('❌ ' + T().cloudFail + ': ' + esc(e.message), 'err', 0);
    return null;
  }
}
function markSync(tool) {
  safeStorageSet('ac_sec_sync_' + tool, nowStr());
  var ts = document.querySelector('.c-ts'); if (ts) ts.textContent = nowStr();
}
function lastSync(tool) { try { return localStorage.getItem('ac_sec_sync_' + tool) || '—'; } catch (e) { return '—'; } }

/* 雲端／Excel 合併工具：同一筆更新，新增筆保留，絕不因較少資料而清空本機。 */
function recordKey(tool, r, i) {
  r = r || {};
  /* 刪除墓碑保存原始穩定鍵，讓另一台裝置能刪掉同一筆，而不是把舊資料合併回來。 */
  if (r._recordKey) return String(r._recordKey);
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
  /* 消防 Excel 內不同設備類型可能重複使用 F001；設備身分必須包含
     類型、廠別、區域、編號與位置，與雲端後端採用相同規則。 */
  if (tool === 'fire') {
    var fireCode = String(r.code || '').trim().toUpperCase().replace(/FOO/g, 'F00');
    var fireType = String(r.type || '').trim().toLowerCase();
    var fireFactory = String(r.factory || r.plant || r.site || '').trim().toLowerCase();
    var fireZone = String(r.zone || '').trim().toLowerCase();
    var fireLoc = String(r.loc || r.location || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (fireCode || fireLoc) return tool + '|equipment|' + [fireType, fireFactory, fireZone, fireCode, fireLoc].join('|');
  }
  /* 巡更棒同一時間＋同一 Chip 是唯一打點；必須先於 _k 判定，
     否則不同裝置下載時的陣列順序會造成重複。 */
  if (tool === 'patrol' && r.t && r.c) return tool + '|scan|' + r.t + '|' + r.c;
  if (r.id !== undefined && r.id !== '') return tool + '|id|' + r.id;
  if (r.code !== undefined && r.code !== '') return tool + '|code|' + r.code;
  if (r._k !== undefined && r._k !== '') return tool + '|kind|' + r._k + '|' + (r.empId || r.name || r.date || i);
  if (r.month && (r.empId || r.name)) return tool + '|month|' + r.month + '|' + (r.empId || r.name);
  if (r.date && (r.empId || r.name)) return tool + '|date|' + r.date + '|' + (r.empId || r.name);
  if (r.date && r.time && (r.guard || r.person || r.name)) return tool + '|event|' + r.date + '|' + r.time + '|' + (r.guard || r.person || r.name) + '|' + (r.location || r.c || '');
  /* 巡更棒整月表有時沒有 Person、每日表有 Person；同一時間同一 Chip 應視為同一筆打點。 */
  if (r.t && (r.c || r.g)) return tool + '|scan|' + r.t + '|' + r.c + '|' + (r.g || '');
  return tool + '|row|' + i + '|' + JSON.stringify(r);
}
function blankValue(v) { return v === undefined || v === null || String(v).trim() === ''; }
/* 照片陣列的簡短指紋：「張數:雜湊」。用來比較照片是否改變，而不必複製 base64 內容。 */
function photoSig(arr) {
  var list = (Array.isArray(arr) ? arr : arr ? [arr] : []).filter(Boolean).map(String), s = list.join('\u0001'), h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list.length + ':' + (h >>> 0).toString(36) + '.' + s.length.toString(36);
}
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
  if(oldRow._assetState||newRow._assetState){
    merged._assetState=mergeObject({state:oldRow._assetState},{state:newRow._assetState},'asset-state').state;
    /* 設備狀態快照只存照片數量＋簡短雜湊（photoN／photoSig），不再複製照片本身；
       用雜湊挑出與最新狀態一致的那一份照片陣列（保留「刻意刪除照片」的原子性）。 */
    var sd=unwrapObject(merged._assetState).data,apply={};
    Object.keys(sd).forEach(function(k){if(k!=='photoN'&&k!=='photoSig')apply[k]=sd[k];});
    Object.assign(merged,apply);
    if(sd.photoSig!==undefined)[newRow,oldRow,merged].some(function(r){var ph=r&&Array.isArray(r.photos)?r.photos:[];if(photoSig(ph)===sd.photoSig){merged.photos=ph;return true;}return false;});
  }
  if(oldRow._rosterHistory||newRow._rosterHistory)merged._rosterHistory=mergeObject(oldRow._rosterHistory||{},newRow._rosterHistory||{},'personnel-months');
  if(oldRow._personnelDelivery||newRow._personnelDelivery)merged._personnelDelivery=mergeObject({delivery:oldRow._personnelDelivery},{delivery:newRow._personnelDelivery},'personnel-notice').delivery;
  return { row:merged, blanks:blanks, incomingWins:newWins };
}
/* ───────── 刪除帳本（墓碑） ─────────
   存在 IndexedDB（key = ac_sec_deleted_v1_<tool>），記憶體快取讓同步呼叫維持同步 API。
   舊版存在 localStorage 的帳本會在載入時「合併」搬移。不再有 5000 筆上限；
   只移除超過 400 天的墓碑（所有裝置早已同步）。 */
var DELETED_KEY = 'ac_sec_deleted_v1_';
var DEL_MAX_AGE_MS = 400 * 86400000;
var DEL_CACHE = {}, DEL_LOADED = false, DEL_PRELOAD_CLEARED = {}, DEL_DIRTY = {}, DEL_FLUSHING = false;
function tombStamp(r) {
  var t = Date.parse(String(r && r.updatedAt || ''));
  return isNaN(t) ? recordStamp(r) : t;
}
function legacyDeleted(tool) {
  try {
    var a = JSON.parse(localStorage.getItem(DELETED_KEY + tool) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (e) { return []; }
}
function deletedMap(rows, into) {
  var out = into || {}, cutoff = Date.now() - DEL_MAX_AGE_MS;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || !r._deleted || !r._recordKey) return;
    var st = tombStamp(r);
    if (st && st < cutoff) return;
    var old = out[r._recordKey];
    if (!old || st >= tombStamp(old)) out[r._recordKey] = r;
  });
  return out;
}
function delValues(m) { return Object.keys(m || {}).map(function (k) { return m[k]; }); }
function delTable(tool) {
  tool = String(tool || '');
  if (!DEL_CACHE[tool]) DEL_CACHE[tool] = deletedMap(DEL_LOADED ? [] : legacyDeleted(tool));
  return DEL_CACHE[tool];
}
function flushDeleted() {
  DEL_FLUSHING = false;
  Object.keys(DEL_DIRTY).forEach(function (tool) {
    delete DEL_DIRTY[tool];
    dbPut(DELETED_KEY + tool, delValues(DEL_CACHE[tool] || {}));
  });
}
function scheduleDeletedFlush(tool) {
  DEL_DIRTY[String(tool || '')] = true;
  if (DEL_FLUSHING) return;
  DEL_FLUSHING = true;
  /* 批次：同一個同步迴圈內的多次標記只寫一次；且一定等帳本載入完成，避免覆蓋舊帳本。 */
  dataReady().then(flushDeleted, flushDeleted);
}
function loadDeletedLedger() {
  function finish(stored) {
    var tools = {};
    Object.keys(stored).concat(Object.keys(DEL_CACHE)).forEach(function (t) { tools[t] = 1; });
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(DELETED_KEY) === 0) tools[k.slice(DELETED_KEY.length)] = 1;
      }
    } catch (_) {}
    var needWrite = {};
    Object.keys(tools).forEach(function (tool) {
      var mem = DEL_CACHE[tool] || {}, merged = deletedMap(stored[tool] || []);
      if (Object.keys(mem).length || legacyDeleted(tool).length || DEL_PRELOAD_CLEARED[tool] ||
          Object.keys(merged).length !== (stored[tool] || []).length) needWrite[tool] = 1;
      deletedMap(legacyDeleted(tool), merged);
      var cleared = DEL_PRELOAD_CLEARED[tool] || {};
      Object.keys(cleared).forEach(function (k) { if (merged[k] && tombStamp(merged[k]) <= cleared[k]) delete merged[k]; });
      /* 載入前已在記憶體做的標記優先（較新）。 */
      delValues(mem).forEach(function (r) { var o = merged[r._recordKey]; if (!o || tombStamp(r) >= tombStamp(o)) merged[r._recordKey] = r; });
      DEL_CACHE[tool] = merged;
    });
    DEL_LOADED = true; DEL_PRELOAD_CLEARED = {};
    /* 已搬進 IndexedDB 後移除 localStorage 舊副本（寫入成功才移除）。 */
    var keys = Object.keys(needWrite);   /* 只有真的有變動才寫回，平常開頁不重寫整本帳本 */
    return Promise.all(keys.map(function (tool) {
      return dbPut(DELETED_KEY + tool, delValues(DEL_CACHE[tool])).then(function (ok) {
        if (ok && DATA_DB) { try { localStorage.removeItem(DELETED_KEY + tool); } catch (_) {} }
      });
    }));
  }
  return openDataDb().then(function (db) {
    return idbKeys(db).then(function (keys) {
      var want = keys.filter(function (k) { return k.indexOf(DELETED_KEY) === 0; }), stored = {};
      return Promise.all(want.map(function (k) {
        return idbGet(db, k).then(function (v) { stored[k.slice(DELETED_KEY.length)] = Array.isArray(v) ? v : []; });
      })).then(function () { return finish(stored); });
    });
  }).catch(function () { return finish({}); });
}
function deletedRows(tool) { return delValues(delTable(tool)); }
function saveDeletedRows(tool, rows) {
  tool = String(tool || '');
  var old = delTable(tool), next = deletedMap(rows), ok = Object.keys(old), nk = Object.keys(next), changed = ok.length !== nk.length;
  if (!changed) for (var i = 0; i < nk.length; i++) if (old[nk[i]] !== next[nk[i]]) { changed = true; break; }
  DEL_CACHE[tool] = next;
  if (changed) scheduleDeletedFlush(tool);
  return delValues(next);
}
function makeTomb(tool, row, at) {
  var key = recordKey(tool, row, 0), tomb = { _deleted:true, _recordKey:key, updatedAt:at };
  /* 保留分桶與舊版後端會使用的純量欄位，但不複製照片或大型內容。 */
  Object.keys(row).forEach(function (k) {
    var v = row[k];
    if (k === '_deleted' || k === '_recordKey' || /photo|image|attach/i.test(k)) return;
    if (v === null || ['string','number','boolean'].indexOf(typeof v) >= 0) tomb[k] = v;
  });
  tomb._deleted = true; tomb._recordKey = key; tomb.updatedAt = at;
  return tomb;
}
/* 批次標記刪除：一次讀、一次寫（巡更清空數萬筆也只寫一次）。 */
function markDeletedMany(tool, rows) {
  if (!tool) return [];
  var t = delTable(tool), at = new Date().toISOString(), out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    var tomb = makeTomb(tool, row, at);
    t[tomb._recordKey] = tomb; out.push(tomb);
  });
  if (out.length) scheduleDeletedFlush(tool);
  return out;
}
function markDeleted(tool, row) {
  if (!tool || !row || typeof row !== 'object') return null;
  return markDeletedMany(tool, [row])[0] || null;
}
function clearDeletedMany(tool, rows) {
  if (!tool) return 0;
  tool = String(tool);
  var t = delTable(tool), n = 0, now = Date.now();
  (Array.isArray(rows) ? rows : []).forEach(function (row, i) {
    if (!row) return;
    var key = recordKey(tool, row, i);
    if (!DEL_LOADED) (DEL_PRELOAD_CLEARED[tool] || (DEL_PRELOAD_CLEARED[tool] = {}))[key] = now;
    if (t[key]) { delete t[key]; n++; }
  });
  if (n) scheduleDeletedFlush(tool);
  return n;
}
function clearDeleted(tool, row) {
  if (!tool || !row) return;
  clearDeletedMany(tool, [row]);
}
function mergeRecords(tool, local, incoming, opts) {
  opts = opts || {};
  var out = [], pos = {}, blankConflicts = [], added = 0, updated = 0;
  function apply(r, i, isIncoming) {
    if (!r || typeof r !== 'object') return;
    var k = recordKey(tool, r, i);
    if (pos[k] === undefined) { pos[k] = out.length; out.push(r); if (isIncoming) added++; }
    else {
      var old = out[pos[k]], m;
      if (old._deleted || r._deleted) {
        var oldStamp = recordStamp(old), newStamp = recordStamp(r);
        /* 時間相同時以後套用者為準；同步呼叫端可用參數順序決定本機或雲端優先。 */
        m = { row:newStamp >= oldStamp ? r : old, blanks:[] };
      } else m = mergeLatestRow(old, r);
      out[pos[k]] = m.row;
      if (isIncoming) { updated++; if (m.blanks.length) blankConflicts.push({ key:k, fields:m.blanks }); }
    }
  }
  (Array.isArray(local) ? local : []).forEach(function (r, i) { apply(r, i, false); });
  /* 每次合併都帶入本機刪除墓碑。這樣即使使用者離線刪除後先按「下載」，
     舊的雲端資料也不會在尚未上傳前被補回來。子資料集合亦沿用相同規則。 */
  if (opts.useStoredTombstones !== false) deletedRows(tool).forEach(function (r, i) { apply(r, i, false); });
  (Array.isArray(incoming) ? incoming : []).forEach(function (r, i) { apply(r, i, true); });
  var tombstones = out.filter(function (r) { return r && r._deleted; });
  /* 保存從其他裝置下載到的刪除狀態；若較新的有效資料勝出，同鍵舊墓碑會在此移除。 */
  if (opts.persistTombstones !== false) saveDeletedRows(tool, tombstones);
  return { records: opts.keepTombstones ? out : out.filter(function (r) { return !(r && r._deleted); }),
    tombstones:tombstones, added: added, updated: updated,
    kept: Math.max(0, out.length - (incoming || []).length), blankConflicts:blankConflicts };
}
function mergeObject(local, incoming, toolPrefix) {
  var out = Object.assign({}, local || {});
  Object.keys(incoming || {}).forEach(function (k) {
    var childTool = toolPrefix ? toolPrefix + '-' + k : 'extra-' + k;
    if (incoming[k] && incoming[k].__secReplace === true) {
      var oldEnv=out[k], oldStamp=oldEnv&&oldEnv.__secReplace===true?recordStamp(oldEnv):0, newStamp=recordStamp(incoming[k]);
      if(!oldEnv||oldEnv.__secReplace!==true||newStamp>=oldStamp)out[k]=incoming[k];
    }
    else if (out[k] && out[k].__secReplace === true) { /* 新格式的完整替換資料不與舊版片段做欄位聯集。 */ }
    else if (Array.isArray(out[k]) && Array.isArray(incoming[k])) out[k] = mergeRecords(childTool, out[k], incoming[k]).records;
    else if (incoming[k] && typeof incoming[k] === 'object' && out[k] && typeof out[k] === 'object' && !Array.isArray(incoming[k])) out[k] = mergeObject(out[k], incoming[k], childTool);
    else if (incoming[k] !== undefined && !(blankValue(incoming[k]) && !blankValue(out[k]))) out[k] = incoming[k];
  });
  return out;
}
function replaceObject(data, updatedAt){return {__secReplace:true,updatedAt:updatedAt||new Date().toISOString(),data:data&&typeof data==='object'?data:{}};}
function unwrapObject(value){return value&&value.__secReplace===true?{data:value.data&&typeof value.data==='object'?value.data:{},updatedAt:value.updatedAt||''}:{data:value&&typeof value==='object'?value:{},updatedAt:''};}
/* 依業務穩定鍵清理跨裝置或重複匯入產生的雙份資料。保留較新的版本，
   並把較新版本中的空白欄位以舊值補回；呼叫端可將 removedRows 轉成刪除墓碑。 */
function dedupeBy(rows, keyFn) {
  var out=[], pos={}, removedRows=[];
  (Array.isArray(rows)?rows:[]).forEach(function(r,i){
    if(!r||typeof r!=='object')return;
    var k='';try{k=String(keyFn(r,i)||'');}catch(e){}
    if(!k)k='__row__'+i;
    if(pos[k]===undefined){pos[k]=out.length;out.push(r);return;}
    var at=pos[k],old=out[at],m=mergeLatestRow(old,r);
    out[at]=m.row;removedRows.push(m.incomingWins?old:r);
  });
  return {records:out,removed:removedRows.length,removedRows:removedRows};
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
  /* 頁面傳入的標題可能是中文；en/km 模式改用通用標題，避免跳出中文。 */
  var head = title && (_lang === 'zh' || !/[㐀-鿿]/.test(String(title))) ? title : L('下載資料', 'Download data', 'ទាញយកទិន្នន័យ');
  return typeof G.confirm !== 'function' || G.confirm(head + '\n\n' +
    L('發現 ' + conflicts.length + ' 個空白欄位。按「確定」會保留原本非空資料並略過空白，不會清除內容。',
      conflicts.length + ' blank field(s) found. Tap OK to keep the existing values and skip the blanks. Nothing will be erased.',
      'រកឃើញវាលទទេ ' + conflicts.length + '។ ចុច OK ដើម្បីរក្សាតម្លៃដើម និងរំលងវាលទទេ។ គ្មានអ្វីត្រូវលុបទេ។') + '\n\n· ' + sample);
}

/* ───────── Telegram 摘要（自動附平台按鈕，由 GAS 加） ───────── */
async function tgSummary(text, module, photo, photos) {
  try {
    var list = Array.isArray(photos) ? photos.filter(Boolean).slice(0, 4) : [];
    if (photo && !list.length) list = [photo];
    var periodHit = String(text || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
    var result = await gasPost({ action:'telegram', text:text, module:module||'', lang:_lang,
      photo:list[0] || '', photos:list, mode:'summary',
      period:periodHit ? periodHit[1] : '', periodType:periodHit ? 'day' : '' });
    if (!result || result.sent !== true) throw new Error((result && result.error) || L('Telegram 未確認送達', 'Telegram did not confirm delivery', 'Telegram មិនបានបញ្ជាក់ការផ្ញើ'));
    scheduleAutoCloudSync(module || '', 'telegram-summary', '');
    toast(L('✈️ Telegram 已送出', '✈️ Sent to Telegram', '✈️ បានផ្ញើទៅ Telegram'), 'ok'); return true;
  } catch (e) { toast('❌ ' + L('Telegram 發送失敗：', 'Telegram failed: ', 'ផ្ញើ Telegram បរាជ័យ៖ ') + esc(e.message), 'err', 0); return false; }
}

/* ───────── Telegram 摘要／核可選擇器（Security 版 GA exp TG.open） ─────────
   讓每個模組都能先選：摘要或核可、日／週／月／年、期間、語言，再送出。
   核可項目由頁面自行提供，後端會依模組限制可送出的資料類型。 */
function tgAnchor(key, type) {
  var s = String(key || '');
  if (type === 'year' && /^\d{4}$/.test(s)) return new Date(+s, 0, 1);
  if (type === 'month' && /^\d{4}-\d{2}$/.test(s)) return new Date(+s.slice(0,4), +s.slice(5,7)-1, 1);
  return parseD(s) || new Date();
}
function tgPeriodLabel(key, type) { return new Period(type, tgAnchor(key, type)).label(); }
/* 頁面傳入的文字可以是 {zh,en,km} 物件；若是舊式中文字串而目前是 en/km，改用通用文字。 */

/* ───────── Telegram 精簡卡片格式（20261002）─────────
   原則：手機一眼看懂。不再用空白補齊的表格（Telegram 引用區塊不是等寬字，必定對不齊）；
   改成「一筆一行、圖示＋重點」：先結論，再異常，正常只計數。
   標籤用 tgLbl() 包起來：「繁中 + English」合併時同一行只把標籤合成「中/英」，數字和名字不會重複。 */
var TG_LO = '⟦', TG_LC = '⟧';
function tgLbl(lang, zh, en, km) {
  var s = lang === 'en' ? en : lang === 'km' ? (km || en) : zh;
  return TG_LO + String(s == null ? '' : s) + TG_LC;
}
function tgStrip(s) { return String(s == null ? '' : s).replace(/[⟦⟧]/g, ''); }
function tgShortDate(v) { v = String(v || ''); return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(5, 10) : v; }
function tgTime(v) { var m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})/); return m ? p2(+m[1]) + ':' + m[2] : ''; }
function tgMinutes(v) { var m = String(v == null ? '' : v).match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function tgDuration(mins) { mins = Math.round(+mins || 0); if (mins <= 0) return ''; var h = Math.floor(mins / 60), m = mins % 60; return h ? h + 'h' + (m ? p2(m) : '') : m + 'm'; }
/* 連續日期壓縮：09-01,09-02,09-03,09-05 → 09-01~03, 09-05 */
function tgDateRanges(dates) {
  var list = Array.from(new Set((dates || []).map(String).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); }))).sort(), out = [], i = 0;
  while (i < list.length) {
    var j = i;
    while (j + 1 < list.length && (parseD(list[j + 1]) - parseD(list[j])) === 86400000) j++;
    out.push(j > i ? tgShortDate(list[i]) + '~' + (list[i].slice(0, 7) === list[j].slice(0, 7) ? list[j].slice(8) : tgShortDate(list[j])) : tgShortDate(list[i]));
    i = j + 1;
  }
  return out.join(', ');
}
/* 指標列：[[圖示, 標籤(已用 tgLbl), 數值], ...]，每行最多 n 個 */
function tgKpis(items, n) {
  n = n || 3; var rows = [], cur = [];
  (items || []).filter(Boolean).forEach(function (x) {
    cur.push(x[0] + ' ' + x[1] + ' <b>' + x[2] + '</b>');
    if (cur.length >= n) { rows.push(cur.join('  ·  ')); cur = []; }
  });
  if (cur.length) rows.push(cur.join('  ·  '));
  return rows.join('\n');
}
function tgHead(icon, title, period, sub) {
  return icon + ' <b>' + title + '</b>' + (period ? '\n📅 ' + esc(period) : '') + (sub ? '\n' + sub : '') + '\n━━━━━━━━━━━━';
}
function tgSec(icon, title) { return '\n\n<b>' + icon + ' ' + title + '</b>'; }
/* 長清單折疊：Telegram 會顯示前幾行，按一下展開全部 */
function tgFold(lines) { lines = (lines || []).filter(function (x) { return x != null && x !== ''; }); return lines.length ? '\n<blockquote expandable>' + lines.join('\n') + '</blockquote>' : ''; }
/* 依字數把多行分頁（每頁 ≤ budget 字），頁首自動加標題 */
function tgChunk(title, lines, budget) {
  budget = budget || 3000; var pages = [], cur = [], size = 0;
  (lines || []).forEach(function (ln) {
    var len = String(ln).length + 1;
    if (cur.length && size + len > budget) { pages.push(title + '\n' + cur.join('\n')); cur = []; size = 0; }
    cur.push(ln); size += len;
  });
  if (cur.length) pages.push(title + '\n' + cur.join('\n'));
  return pages;
}
/* 彩色進度條：🟩 好／🟨 普通／🟥 差，一眼看到比例（Telegram 文字也能有「視覺」） */
function tgBar(value, total, width) {
  width = width || 10; total = Number(total) || 0; value = Number(value) || 0;
  if (total <= 0) return '';
  var r = Math.max(0, Math.min(1, value / total)), n = Math.round(r * width), block = r >= 0.9 ? '🟩' : r >= 0.7 ? '🟨' : '🟥', out = '';
  for (var i = 0; i < width; i++) out += i < n ? block : '⬜';
  return out + ' ' + Math.round(r * 100) + '%';
}
/* 狀態燈：訊息第一行就知道要不要處理。level: 'ok' | 'warn' | 'bad' */
function tgVerdict(level, text) {
  var dot = level === 'bad' ? '🔴' : level === 'warn' ? '🟠' : '🟢';
  return dot + ' <b>' + String(text == null ? '' : text) + '</b>';
}
var TG = { lbl:tgLbl, strip:tgStrip, d:tgShortDate, time:tgTime, mins:tgMinutes, dur:tgDuration, ranges:tgDateRanges,
  kpis:tgKpis, head:tgHead, sec:tgSec, fold:tgFold, chunk:tgChunk, bar:tgBar, verdict:tgVerdict };

/* 送出成功動畫（只在網頁上，不影響 Telegram 內容） */
function tgSentFx(text) {
  try {
    var fx = document.createElement('div');
    fx.className = 'tg-fx';
    fx.innerHTML = '<div class="tg-fx-card"><div class="tg-fx-plane">✈️</div><div class="tg-fx-check">✓</div><b>' + esc(text || '') + '</b></div>';
    document.body.appendChild(fx);
    setTimeout(function () { fx.classList.add('out'); }, 1500);
    setTimeout(function () { if (fx.parentNode) fx.parentNode.removeChild(fx); }, 2000);
  } catch (e) {}
}

function pageText(v, fallbackZh, fallbackEn, fallbackKm) {
  if (v && typeof v === 'object') return L(v);
  if (v != null && v !== '' && (_lang === 'zh' || !/[㐀-鿿]/.test(String(v)))) return String(v);
  return L(fallbackZh, fallbackEn, fallbackKm);
}
function liveItems(list) { return (Array.isArray(list) ? list : []).filter(function (r) { return r && !r._deleted; }); }
function tgOpen(opt) {
  opt = opt || {};
  var firstType = opt.defaultType || 'month';
  /* en/km 介面預設用同語言發送，預覽不出現中文；使用者仍可自行改選。 */
  var defLang = opt.defaultLang || 'both';
  if (_lang !== 'zh' && (defLang === 'both' || defLang === 'zh')) defLang = _lang;
  var st = { mode:'summary', ptype:firstType, period:opt.defaultPeriod || '',
    lang:defLang, scope:opt.defaultScope || (opt.scopeOptions && opt.scopeOptions[0] ? opt.scopeOptions[0].value : ''),
    includeDetails:false };
  var mask = document.createElement('div');
  mask.className = 'mask on tg-mask';
  var scopeHtml = opt.scopeOptions && opt.scopeOptions.length ?
    '<div class="f"><label>' + esc(L('資料範圍', 'Scope', 'វិសាលភាព')) + '</label><select id="tgScope">' + opt.scopeOptions.map(function (x) {
      return '<option value="' + esc(x.value) + '">' + esc(x.label && typeof x.label === 'object' ? L(x.label) : x.label) + '</option>';
    }).join('') + '</select></div>' : '';
  var langHtml = '<option value="both">' + esc(L('繁中 + English', 'Chinese + English', 'ចិន + អង់គ្លេស')) + '</option>' +
    '<option value="zh">' + esc(L('繁體中文', 'Chinese', 'ភាសាចិន')) + '</option>' +
    '<option value="en">' + esc(L('English', 'English', 'អង់គ្លេស')) + '</option>' +
    '<option value="km">' + esc(L('ខ្មែរ（高棉文）', 'Khmer', 'ខ្មែរ')) + '</option>';
  var Lx = T();
  var sendText = L('✈️ 確認傳送', '✈️ Send', '✈️ ផ្ញើ');
  mask.innerHTML =
    '<div class="modal" style="max-width:560px">' +
      '<div class="mh"><span>✈️</span><b>' + esc(pageText(opt.modalTitle,
          opt.canApprove ? 'Telegram 摘要／核可' : 'Telegram 摘要', opt.canApprove ? 'Telegram summary / approval' : 'Telegram summary',
          opt.canApprove ? 'សេចក្តីសង្ខេប / ការអនុម័ត Telegram' : 'សេចក្តីសង្ខេប Telegram')) + '</b>' +
        '<button class="x" data-tg-close aria-label="' + esc(Lx.close) + '">×</button></div>' +
      '<div class="mb">' +
        '<div class="f"><label>' + esc(L('傳送模式', 'Mode', 'របៀបផ្ញើ')) + '</label><div class="row" id="tgMode">' +
          '<button class="btn sm" data-tg-mode="summary">📄 ' + esc(L('摘要', 'Summary', 'សេចក្តីសង្ខេប')) + '</button>' +
          (opt.canApprove ? '<button class="btn sm gh" data-tg-mode="approval">✅ ' + esc(pageText(opt.approvalLabel, '保安費核可', 'Approval', 'ការអនុម័ត')) + '</button>' : '') +
        '</div></div>' +
        '<div class="grid ' + (scopeHtml ? 'g3' : 'g2') + '" style="margin-top:10px">' +
          '<div class="f"><label>' + esc(L('期間類型', 'Period type', 'ប្រភេទរយៈពេល')) + '</label><select id="tgType">' +
            '<option value="day">' + esc(Lx.day) + '</option><option value="week">' + esc(Lx.week) + '</option>' +
            '<option value="month" selected>' + esc(Lx.month) + '</option><option value="year">' + esc(Lx.year) + '</option>' +
          '</select></div>' +
          '<div class="f"><label>' + esc(L('選擇期間', 'Select period', 'ជ្រើសរយៈពេល')) + '</label><input id="tgAnchor" list="tgKnown" type="date"><datalist id="tgKnown"></datalist></div>' +
          scopeHtml +
        '</div>' +
        '<div class="f" style="margin-top:10px"><label>' + esc(L('訊息語言', 'Message language', 'ភាសាសារ')) + '</label><select id="tgLang">' + langHtml +
        '</select></div>' +
        '<div class="f" id="tgDetailBox" style="margin-top:10px"><label style="display:flex;gap:8px;align-items:flex-start">' +
          '<input id="tgDetails" type="checkbox" style="margin-top:3px;width:auto"> <span><b>' + esc(L('附逐筆明細', 'Include record details', 'ភ្ជាប់ព័ត៌មានលម្អិតនីមួយៗ')) + '</b><br>' +
          '<small>' + esc(L('預設只發精簡統計；勾選後，傳送前還會再次確認。', 'A short summary is sent by default; details need a second confirmation.',
            'លំនាំដើមផ្ញើតែសេចក្តីសង្ខេបខ្លី។ ព័ត៌មានលម្អិតត្រូវបញ្ជាក់ម្តងទៀត។')) + '</small></span></label></div>' +
        '<div class="f" style="margin-top:10px"><label>' + esc(L('訊息預覽', 'Preview', 'មើលសារជាមុន')) + '</label>' +
          '<pre id="tgPreview" style="white-space:pre-wrap;max-height:330px;overflow:auto;background:#f6f8fb;border:1px solid var(--line);border-radius:9px;padding:11px;font:12px/1.55 system-ui,sans-serif"></pre></div>' +
        '<p id="tgNote" class="hint" style="margin-top:8px"></p>' +
      '</div>' +
      '<div class="mf"><button class="btn gray" data-tg-close>' + esc(Lx.cancel) + '</button>' +
        '<button class="btn" id="tgSend">' + esc(sendText) + '</button></div>' +
    '</div>';
  document.body.appendChild(mask);
  var q = function (s) { return mask.querySelector(s); };
  var sending = false;
  var close = function () { if (!sending) mask.remove(); };
  mask.querySelectorAll('[data-tg-close]').forEach(function (b) { b.onclick = close; });
  mask.onclick = function (e) { if (e.target === mask) close(); };
  q('#tgType').value = firstType;
  q('#tgLang').value = st.lang;
  if(opt.hideDetails)q('#tgDetailBox').style.display='none';
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
      var detailBox = q('#tgDetailBox');
      if (detailBox) detailBox.style.display = st.mode === 'approval' || opt.hideDetails ? 'none' : '';
      q('#tgNote').textContent = st.mode === 'approval'
      ? pageText(opt.approvalNote, '未送核項目會建立新批次；已送出但仍待核可的項目會更新原批次，不會重複建立資料。Telegram 群組會顯示逐筆核可／退件、翻頁、全部核可及關閉批次按鈕。',
          'New items create a new batch; items already waiting for approval update their batch without duplicates. The Telegram group shows approve/reject buttons for each item.',
          'ធាតុថ្មីបង្កើតបាច់ថ្មី។ ធាតុដែលកំពុងរង់ចាំនឹងធ្វើបច្ចុប្បន្នភាពបាច់ដើម ដោយមិនស្ទួន។ ក្រុម Telegram មានប៊ូតុងអនុម័ត/បដិសេធសម្រាប់ធាតុនីមួយៗ។')
      : (st.includeDetails
        ? L('⚠️ 已選擇逐筆明細；傳送時會再次確認。相同內容與相同照片不會重複送到群組。', '⚠️ Record details selected; you will be asked to confirm. Identical content and photos are never sent twice.',
            '⚠️ បានជ្រើសព័ត៌មានលម្អិត។ នឹងសួរបញ្ជាក់ម្តងទៀត។ ខ្លឹមសារ និងរូបថតដដែលមិនផ្ញើពីរដងទេ។')
        : L('摘要只是通知，不會改變資料狀態；相同內容與相同照片不會重複送到群組。', 'A summary is only a notice and does not change any data. Identical content and photos are never sent twice.',
            'សេចក្តីសង្ខេបគ្រាន់តែជាការជូនដំណឹង មិនប្តូរទិន្នន័យទេ។ ខ្លឹមសារ និងរូបថតដដែលមិនផ្ញើពីរដងទេ។'));
  }
  function summaryPages() {
    function one(s) {
      var v = opt.summaryPages ? opt.summaryPages(s) : (opt.summary ? opt.summary(s) : L('（沒有摘要內容）', '(No summary content)', '(គ្មានខ្លឹមសារសង្ខេប)'));
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      return [String(v || L('（本期間沒有資料）', '(No data in this period)', '(គ្មានទិន្នន័យក្នុងរយៈពេលនេះ)'))];
    }
    if (st.lang !== 'both') return one(st).map(tgStrip);
    function plain(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
    function divider(s) { return /^[\s─━—_\-]+$/.test(String(s || '')); }
    function mergePage(zhPage, enPage) {
      var zhLines = String(zhPage || '').split('\n'), enLines = String(enPage || '').split('\n');
      var n = Math.max(zhLines.length, enLines.length), merged = [];
      for (var j = 0; j < n; j++) {
        var z = zhLines[j] || '', e = enLines[j] || '';
        /* 標籤式行：骨架（去掉標籤）相同 → 只合併標籤「中/英」，數字與名字只出現一次 */
        var lab = /\u27E6[^\u27E7]*\u27E7/g;
        if (z && e && z.indexOf(TG_LO) >= 0 && z.replace(lab, TG_LO) === e.replace(lab, TG_LO)) {
          var el = e.match(lab) || [], k = 0;
          merged.push(z.replace(lab, function (m) { var a = m.slice(1, -1), b = String(el[k++] || '').slice(1, -1); return !b || plain(a) === plain(b) ? a : a + '/' + b; }));
          continue;
        }
        if (!z) { merged.push(e); continue; }
        if (!e || plain(z) === plain(e) || (divider(z) && divider(e))) { merged.push(z); continue; }
        merged.push(z + ' / ' + e);
      }
      return merged.join('\n');
    }
    var zh = one(Object.assign({}, st, { lang:'zh' }));
    var en = one(Object.assign({}, st, { lang:'en' }));
    var n = Math.max(zh.length, en.length), out = [];
    for (var i = 0; i < n; i++) {
      out.push(tgStrip(mergePage(zh[i] || '（本頁沒有中文資料）', en[i] || '(No English data on this page)')));
    }
    return out;
  }
  function canApproveNow() {
    return (opt.module === 'expense' || opt.module === 'commute') &&
      (typeof opt.canApprove === 'function' ? !!opt.canApprove(st) : !!opt.canApprove);
  }
  function syncApprovalMode() {
    var allowed=canApproveNow(), button=q('[data-tg-mode="approval"]');
    if (button) { button.hidden=!allowed; button.style.display=allowed?'':'none'; button.disabled=!allowed; }
    if (!allowed && st.mode === 'approval') st.mode='summary';
    mask.querySelectorAll('[data-tg-mode]').forEach(function(b){b.classList.toggle('on',b.dataset.tgMode===st.mode);});
    note();
  }
  /* 核可預覽使用「訊息語言」；both 以中文為主（與後端一致）。 */
  function ml(zh, en, km) { var l = st.lang === 'both' ? 'zh' : st.lang; return l === 'en' ? en : l === 'km' ? (km || en) : zh; }
  function preview() {
    syncApprovalMode();
    var text = '';
    try {
      if (st.mode === 'approval') {
        var items = liveItems(opt.approvalItems ? opt.approvalItems(st) : []);
        if (typeof opt.approvalPreview === 'function') {
          text = String(opt.approvalPreview(st, items) || L('（沒有可送核資料）', '(Nothing to send for approval)', '(គ្មានអ្វីត្រូវស្នើអនុម័ត)'));
        } else {
          var amt = items.reduce(function (a, r) { return a + (Number(r.amount) || 0); }, 0);
          text = ml('💰 保安費核可請求', '💰 Security fee approval request', '💰 សំណើអនុម័តថ្លៃសន្តិសុខ') + '\n' +
            ml('期間：', 'Period: ', 'រយៈពេល៖ ') + tgPeriodLabel(st.period, st.ptype) +
          '\n─────────────\n' + ml('筆數：', 'Items: ', 'ចំនួន៖ ') + items.length + '  ' + ml('合計：', 'Total: ', 'សរុប៖ ') + '$' + amt.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) +
          '\n\n' + items.slice(0, 10).map(function (r, i) {
            return (i + 1) + '. ' + esc(r.name || r.item || '—') + ' · $' + Number(r.amount || 0).toFixed(2) +
              (r.reason ? '\n   ' + esc(r.reason) : '');
          }).join('\n') + (items.length > 10 ? '\n… ' + ml('另有 ' + (items.length - 10) + ' 筆', (items.length - 10) + ' more', 'និង ' + (items.length - 10) + ' ទៀត') : '');
        }
        q('#tgSend').disabled = sending || !items.length;
      } else {
        var pages = summaryPages();
        text = pages.length > 1 ? pages.map(function (x, i) { return '【' + (i + 1) + '/' + pages.length + '】\n' + x; }).join('\n\n') : pages[0];
        q('#tgSend').disabled = sending || (typeof opt.canSendSummary === 'function' && !opt.canSendSummary(st));
      }
    } catch (e) { text = '⚠️ ' + esc(e.message); q('#tgSend').disabled = true; }
    /* Telegram uses HTML markup; render the same markup in the preview so tags such as <b> do not appear as raw text. */
    q('#tgPreview').innerHTML = text;
  }
  q('#tgType').onchange = function () { st.ptype = this.value; fillPeriods(true); preview(); };
  q('#tgAnchor').onchange = function () { st.period = readAnchor(); preview(); };
  q('#tgLang').onchange = function () { st.lang = this.value; preview(); };
  q('#tgDetails').onchange = function () { st.includeDetails = !!this.checked; note(); preview(); };
  if (q('#tgScope')) q('#tgScope').onchange = function () { st.scope = this.value; preview(); };
  mask.querySelectorAll('[data-tg-mode]').forEach(function (b) {
    b.onclick = function () {
      if (b.dataset.tgMode === 'approval' && !canApproveNow()) return;
      st.mode = b.dataset.tgMode;
      mask.querySelectorAll('[data-tg-mode]').forEach(function (x) { x.classList.toggle('on', x === b); });
      note(); preview();
    };
  });
  q('[data-tg-mode="summary"]').classList.add('on');
  function cancelled() { var e = new Error(L('已取消傳送', 'Sending cancelled', 'បានបោះបង់ការផ្ញើ')); e.cancelled = true; return e; }
  q('#tgSend').onclick = async function () {
    if(sending)return;sending=true;
    var btn = this; btn.disabled = true; btn.textContent = L('⏳ 傳送中…', '⏳ Sending…', '⏳ កំពុងផ្ញើ…');
    mask.classList.add('busy');
    try {
      if (st.mode === 'summary') {
        if(typeof opt.canSendSummary==='function'&&!opt.canSendSummary(st))throw new Error(L('沒有待發資料', 'No records to send', 'គ្មានកំណត់ត្រាត្រូវផ្ញើ'));
        var pages = summaryPages();
        if (st.includeDetails && typeof G.confirm === 'function' && !G.confirm(L(
          '⚠️ 您已選擇「附逐筆明細」。\n\n群組將收到每筆日期、時間與人員資料，訊息可能較長。確定仍要發送？',
          '⚠️ You chose "Include record details".\n\nThe group will receive every record with date, time and people. The message may be long. Send anyway?',
          '⚠️ អ្នកបានជ្រើស «ភ្ជាប់ព័ត៌មានលម្អិត»។\n\nក្រុមនឹងទទួលកំណត់ត្រានីមួយៗ។ សារអាចវែង។ ផ្ញើដដែលឬ?'))) {
          throw cancelled();
        }
        if (typeof opt.beforeSummarySend === 'function') {
          var allowed = await opt.beforeSummarySend(st, pages);
          if (allowed === false) throw cancelled();
        }
        var batchPages = [];
        for (var pi = 0; pi < pages.length; pi++) {
          var pageText2 = pages.length > 1 ? '【' + (pi + 1) + '/' + pages.length + '】\n' + pages[pi] : pages[pi];
          var pagePhotos = [];
          if (typeof opt.summaryPhotos === 'function') {
            pagePhotos = opt.summaryPhotos(st, pi, pages.length, pageText2) || [];
            if (!Array.isArray(pagePhotos)) pagePhotos = [pagePhotos];
            pagePhotos = pagePhotos.filter(Boolean).slice(0, 4);
          }
          batchPages.push({ text:pageText2, photo:pagePhotos[0] || '', photos:pagePhotos });
        }
        /* Send one request to GAS. GAS serialises every page/photo through one
           2.5-second Telegram queue, matching HRA Portal and avoiding browser
           requests racing each other into Telegram HTTP 429. */
        var sentResult = await gasPost({ action:'telegramBatch', pages:batchPages, module:opt.module||'', lang:st.lang,
          mode:'summary', reportKind:opt.reportKind||'', period:st.period, periodType:st.ptype, scope:st.scope || '', includeDetails:!!st.includeDetails });
        if (!sentResult || sentResult.sent !== true) {
          var failedPage = sentResult && sentResult.failedPage ? Number(sentResult.failedPage) : 1;
          var reason = sentResult && sentResult.error ? String(sentResult.error) : '';
          throw new Error(L('第 ' + failedPage + '/' + pages.length + ' 頁未送達群組', 'Page ' + failedPage + '/' + pages.length + ' was not delivered to the group',
            'ទំព័រ ' + failedPage + '/' + pages.length + ' មិនបានផ្ញើដល់ក្រុម') + (reason ? ': ' + reason : ''));
        }
        if(typeof opt.onSummarySent==='function')await opt.onSummarySent(st,sentResult);
        scheduleAutoCloudSync(opt.module || '', opt.reportKind==='masterChanges'?'master-summary':'telegram-summary', st.period || '');
        if (sentResult.skippedDuplicate) toast(L('♻️ 相同摘要已送過，本次未重複發送', '♻️ The same summary was already sent; not sent again', '♻️ សេចក្តីសង្ខេបដដែលបានផ្ញើរួចហើយ មិនផ្ញើម្តងទៀតទេ'), 'warn', 5500);
        else { toast(L('✈️ Telegram 摘要已送出', '✈️ Telegram summary sent', '✈️ បានផ្ញើសេចក្តីសង្ខេប Telegram') + (pages.length > 1 ? ' (' + pages.length + ')' : ''), 'ok'); tgSentFx(L('已送到群組', 'Sent to the group', 'បានផ្ញើទៅក្រុម')); }
      } else {
        var items = liveItems(opt.approvalItems ? opt.approvalItems(st) : []);
        if (!canApproveNow() || !approvalItemsAllowed(opt.module, items)) throw new Error(L('此類記錄不需核可，請傳送摘要', 'These records are summary-only', 'កំណត់ត្រាទាំងនេះសម្រាប់តែសេចក្តីសង្ខេប'));
        var result = opt.onApprovalSend
          ? await opt.onApprovalSend(st, items)
          : await sendApproval({ module:opt.module, period:st.period, title:opt.approvalTitle || '', route:opt.route,
              lang:st.lang === 'both' ? 'zh' : st.lang, periodType:st.ptype, items:items });
        if (!result) throw new Error(L('核可請求未送出', 'The approval request was not sent', 'សំណើអនុម័តមិនត្រូវបានផ្ញើ'));
        if (opt.onApprovalSent) opt.onApprovalSent(result, st, items);
        tgSentFx(L('核可請求已送出', 'Approval request sent', 'បានផ្ញើសំណើអនុម័ត'));
      }
      sending = false;
      close();
    } catch (e) {
      toast((e && e.cancelled ? 'ℹ️ ' : '❌ ') + esc(e && e.message || e), e && e.cancelled ? 'warn' : 'err', e && e.cancelled ? 3000 : 0);
      btn.textContent = sendText;
      sending = false;
      btn.disabled = false;
    } finally { sending = false; mask.classList.remove('busy'); }
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
/* SEC approval policy: operational logs are summary-only. */
function approvalItemsAllowed(module, items) {
  if (!Array.isArray(items) || !items.length) return false;
  return items.every(function(it) {
    if (!it) return false;
    if (module === 'expense') return /security\s*(service\s*)?fee|保安服務費|保安費|security service/i.test(String(it.dept || it.category || it.name || ''));
    if (module !== 'commute') return false;
    var kind=String(it.kind || '').toLowerCase(), group=String(it.group || '').toLowerCase();
    if (kind && !/^commute[-_]vehicle$/.test(kind)) return false;
    if (group && group !== 'vehicle') return false;
    return /^commute[-_]vehicle$/.test(kind) || group === 'vehicle' || /^(vehicle dispatch|車輛派遣)$/i.test(String(it.dept || it.category || ''));
  });
}
async function sendApproval(opt) {
  opt = opt || {};
  opt.items = liveItems(opt.items);
  if (!approvalItemsAllowed(opt.module, opt.items)) throw new Error(L('此類記錄不需核可，請傳送摘要', 'These records are summary-only', 'កំណត់ត្រាទាំងនេះសម្រាប់តែសេចក្តីសង្ខេប'));
  var c = getCfg();
  var body = {
    action : 'approvalRequest',
    module : opt.module,
    period : opt.period || '',
    title  : opt.title || '',
    lang   : opt.lang || _lang,
    route  : opt.route || c.route || 'review',
    requestedBy : c.operator || 'web',
    periodType : opt.periodType || '',
    items  : opt.items || [],
  };
  if (opt.batch) body.batch = opt.batch;
  if (!body.items.length) { toast(L('⚠️ 沒有可送核可的項目', '⚠️ Nothing to send for approval', '⚠️ គ្មានអ្វីត្រូវស្នើអនុម័ត'), 'warn'); return null; }
  var pendingToast = toast('<span class="spin">⏳</span> ' + L('送出核可中…', 'Sending for approval…', 'កំពុងផ្ញើសុំអនុម័ត…') + ' (' + body.items.length + ')', '', 0);
  try {
    var r = await gasPost(body);
    if (pendingToast && pendingToast.parentNode) pendingToast.parentNode.removeChild(pendingToast);
    toast(L('✅ 已送出核可', '✅ Sent for approval', '✅ បានផ្ញើសុំអនុម័ត') + ' <b>' + esc(r.batchId||'') + '</b> · ' + (r.count||0) + ' · ' +
          (r.route === 'direct' ? '🚀 ' + T().routeDirect : '👥 ' + T().routeReview), 'ok', 5000);
    scheduleAutoCloudSync(opt.module || '', 'approval-request', opt.period || '');
    return r;
  } catch (e) {
    if (pendingToast && pendingToast.parentNode) pendingToast.parentNode.removeChild(pendingToast);
    toast('❌ ' + L('送出失敗：', 'Sending failed: ', 'ផ្ញើបរាជ័យ៖ ') + esc(e.message), 'err', 0); return null;
  }
}

/* ───────── 照片（壓縮成 dataURL，免後端） ───────── */
function pickPhoto(cb, maxW, maxCount) {
  var mask = document.createElement('div');
  mask.className = 'mask on';
  mask.style.zIndex = 3200;
  mask.innerHTML = '<div class="modal" style="max-width:420px">' +
    '<div class="mh"><b>📷 ' + esc(L('照片', 'Photo', 'រូបថត')) + '</b><button class="x" data-photo-close aria-label="' + esc(T().close) + '">×</button></div>' +
    '<div class="mb"><p class="hint" style="margin-bottom:12px">' + esc(L('請選擇直接拍照，或從相簿選圖片。', 'Take a photo now, or choose images from the gallery.', 'ថតរូបឥឡូវ ឬជ្រើសរូបពីវិចិត្រសាល។')) + '</p>' +
    '<div class="grid g2"><button class="btn photo-choice" data-photo-camera>📷 ' + esc(L('直接拍照', 'Take photo', 'ថតរូប')) + '</button>' +
    '<button class="btn gh photo-choice" data-photo-file>🖼️ ' + esc(L('相簿／檔案', 'Gallery / files', 'វិចិត្រសាល / ឯកសារ')) + '</button></div></div>' +
    '<div class="mf"><button class="btn gray" data-photo-close>' + esc(T().cancel) + '</button></div></div>';
  document.body.appendChild(mask);
  function close() { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); }
  function choose(camera) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    if (camera) inp.setAttribute('capture', 'environment');
    else inp.multiple = true;
    inp.onchange = function () {
      Array.prototype.slice.call(inp.files || [], 0, camera ? 1 : (maxCount || 4)).forEach(function (f) {
        compressImage(f, maxW || 760, cb);
      });
      close();
    };
    inp.click();
  }
  mask.querySelectorAll('[data-photo-close]').forEach(function (b) { b.onclick = close; });
  mask.querySelector('[data-photo-camera]').onclick = function () { choose(true); };
  mask.querySelector('[data-photo-file]').onclick = function () { choose(false); };
  mask.onclick = function (e) { if (e.target === mask) close(); };
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
      if (typeof XLSX === 'undefined') throw new Error(L('Excel 元件尚未載入', 'The Excel component is not loaded', 'កម្មវិធី Excel មិនទាន់ផ្ទុក'));
      /* 慣例：cellDates:false, raw:true。日期以 Excel 序號（例如 46266）或字串進來，
         時間以小數（0.354 = 08:30）或日期＋時間序號進來；請用 SEC.parseD／SEC.parseTime 轉換。
         不使用 cellDates:true —— 那會在 Asia/Phnom_Penh 等時區造成日期早一天、時間早幾秒。 */
      var wb = XLSX.read(new Uint8Array(e.target.result), {
        type:'array', cellDates:false, cellNF:true, raw:true
      });
      var sheets = wb.SheetNames.map(function (n) {
        return { name:n, fileName:file.name || '', rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:'', raw:true, blankrows:false }) };
      });
      cb(sheets, wb);
    } catch (err) {
      var em = String(err && err.message || err);
      var hint = /zip|central directory|end of central|eof|corrupt|invalid/i.test(em)
        ? L('檔案可能已損壞，請用 Excel 開啟原檔「另存新檔」後再匯入。', 'The file may be damaged. Open it in Excel, use "Save As", then import again.', 'ឯកសារអាចខូច។ បើកក្នុង Excel ហើយ «រក្សាទុកជា» រួចនាំចូលម្តងទៀត។')
        : L('請重新整理頁面後再試。', 'Please reload the page and try again.', 'សូមផ្ទុកទំព័រឡើងវិញ ហើយព្យាយាមម្តងទៀត។');
      toast('❌ ' + L('Excel 讀取失敗：', 'Could not read the Excel file: ', 'មិនអាចអានឯកសារ Excel៖ ') + esc(em) + '<br>' + hint, 'err', 0);
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

function xlsxMissingText() {
  return L('❌ Excel 元件未載入，請重新整理後再試', '❌ The Excel component is not loaded. Reload the page and try again.', '❌ កម្មវិធី Excel មិនទាន់ផ្ទុក។ សូមផ្ទុកទំព័រឡើងវិញ។');
}
/* ── 匯出 Excel（多工作表） ── */
function exportExcel(sheets, filename) {
  if (typeof XLSX === 'undefined') { toast(xlsxMissingText(), 'err', 0); return; }
  var wb = XLSX.utils.book_new();
  sheets.forEach(function (s) {
    var ws = Array.isArray(s.rows[0]) ? XLSX.utils.aoa_to_sheet(s.rows)
                                      : XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, String(s.name || 'Sheet').slice(0, 30));
  });
  XLSX.writeFile(wb, filename || ('AC_SEC_' + ymd() + '.xlsx'));
  toast(L('📊 Excel 已匯出', '📊 Excel exported', '📊 បាននាំចេញ Excel'), 'ok');
}
/* ── JSON 備份 / 還原 ── */
function backupJson(obj, filename) {
  var b = new Blob([JSON.stringify(obj, null, 2)], { type:'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = filename || ('AC_SEC_backup_' + ymd() + '.json');
  a.click();
  toast(L('💾 備份完成', '💾 Backup saved', '💾 បានរក្សាទុកការបម្រុងទុក'), 'ok');
}
function restoreJson(cb) {
  var inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = function () {
    var f = inp.files[0]; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try { cb(JSON.parse(fr.result)); toast(L('✅ 還原完成', '✅ Restore complete', '✅ ស្តាររួចរាល់'), 'ok'); }
      catch (e) { toast(L('❌ 檔案格式錯誤，請選擇本平台匯出的備份檔。', '❌ Wrong file format. Choose a backup file exported from this platform.', '❌ ទម្រង់ឯកសារខុស។ សូមជ្រើសឯកសារបម្រុងទុកពីវេទិកានេះ។'), 'err', 0); }
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
    if (typeof XLSX === 'undefined') { toast(xlsxMissingText(), 'err', 0); return; }
    readWorkbook(inp.files[0], cb);
  };
  inp.click();
}

/* ───────── 共用 Header ─────────
   保安常用：🏠、語言、✈️ Telegram 一直顯示（≥44px）；
   管理用：上傳、下載、智慧匯入、設定收進「⋯」選單（按鈕 id 不變：btnUp/btnDown/btnSmart/btnCfg）。
   title / sub 可傳字串，或 {zh,en,km} 物件（切換語言時自動更新）。 */
function i18nText(v, cls) {
  if (v && typeof v === 'object') return '<span class="' + cls + '"' + i18nAttrs(v.zh || v.en || '', v.en || v.zh || '', v.km || v.en || '') + '>' + esc(L(v)) + '</span>';
  return '<span class="' + cls + '">' + esc(v) + '</span>';
}
function hdrBtn(id, icon, zh, en, km, extraCls, tag, href) {
  var t = tag || 'button';
  return '<' + t + ' class="ic-btn' + (extraCls ? ' ' + extraCls : '') + '" id="' + id + '"' + (href ? ' href="' + href + '"' : ' type="button"') +
    i18nAttrs(zh, en, km, 'data-tip-') + ' title="' + esc(L(zh, en, km)) + '" aria-label="' + esc(L(zh, en, km)) + '">' +
    '<span class="ic-i" aria-hidden="true">' + icon + '</span><span class="ic-lbl"' + i18nAttrs(zh, en, km) + '>' + esc(L(zh, en, km)) + '</span></' + t + '>';
}
function menuItem(id, icon, zh, en, km) {
  return '<button type="button" class="more-item" role="menuitem" id="' + id + '"><span class="ic-i" aria-hidden="true">' + icon + '</span>' +
    '<span' + i18nAttrs(zh, en, km) + '>' + esc(L(zh, en, km)) + '</span></button>';
}
function headerHtml(icon, title, sub) {
  return '<div class="hdr">' +
    '<div class="hdr-top">' +
      '<div class="hdr-ic">' + icon + '</div>' +
      '<div class="hdr-title">' + i18nText(title, 'hdr-t1') + i18nText(sub || 'AC SECURITY PLATFORM', 'hdr-t2') + '</div>' +
      '<div class="hdr-right">' +
        '<div class="lang-sw" role="group" aria-label="Language">' +
          /* en/km 模式畫面不可出現中文：中文鈕在 en/km 顯示「ZH」。 */
          '<button type="button" class="lb" data-l="zh" lang="zh-Hant"' + i18nAttrs('繁中', 'ZH', 'ZH') + i18nAttrs('繁體中文', 'Chinese', 'ភាសាចិន', 'data-tip-') + '>' + (_lang === 'zh' ? '繁中' : 'ZH') + '</button>' +
          '<button type="button" class="lb" data-l="en" lang="en">EN</button>' +
          '<button type="button" class="lb" data-l="km" lang="km">ខ្មែរ</button>' +
        '</div>' +
        hdrBtn('btnTg', '✈️', 'Telegram', 'Telegram', 'Telegram') +
        hdrBtn('btnHome', '🏠', '首頁', 'Home', 'ទំព័រដើម', '', 'a', 'index.html') +
        '<div class="more-wrap">' +
          hdrBtn('btnMore', '⋯', '管理', 'More', 'បន្ថែម', 'more-btn') +
          '<div class="more-menu" id="secMoreMenu" role="menu" hidden>' +
            menuItem('btnUp', '⬆️☁', '上傳雲端', 'Upload to cloud', 'ផ្ទុកឡើងពពក') +
            menuItem('btnDown', '⬇️☁', '從雲端更新', 'Update from cloud', 'ធ្វើបច្ចុប្បន្នភាពពីពពក') +
            menuItem('btnSmart', '📥', '智慧匯入 Excel', 'Smart Excel import', 'នាំចូល Excel ឆ្លាតវៃ') +
            menuItem('btnCfg', '⚙️', '設定', 'Settings', 'ការកំណត់') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="cloud-bar" id="cloudBar" role="status">' +
      '<span class="c-dot"></span>' +
      '<span class="c-state">' + esc(autoSyncText('idle')) + '</span><span class="c-ts">—</span>' +
    '</div>' +
  '</div>';
}
function bindHeader(tool, handlers) {
  handlers = handlers || {};
  HEADER_TOOL = String(tool || '');
  document.querySelectorAll('.lang-sw .lb').forEach(function (b) {
    b.onclick = function () { setLang(b.dataset.l); };
  });
  var ts = document.querySelector('.c-ts'); if (ts) ts.textContent = lastSync(tool);
  var menu = document.getElementById('secMoreMenu'), more = document.getElementById('btnMore');
  function closeMenu() { if (menu) menu.hidden = true; if (more) more.setAttribute('aria-expanded', 'false'); }
  if (more && menu) {
    more.onclick = function (ev) {
      ev.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open; more.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    document.addEventListener('click', function (ev) { if (!menu.hidden && !closest(ev.target, '.more-wrap')) closeMenu(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeMenu(); });
  }
  function run(fn, ev) {
    try {
      var out = fn(ev);
      if (out && typeof out.catch === 'function') out.catch(function (e) { bootError(e); });
      return out;
    } catch (e) { bootError(e); }
  }
  function bindAction(id, fn) {
    var el = document.getElementById(id); if (!el || typeof fn !== 'function') return;
    el.onclick = function (ev) { closeMenu(); run(fn, ev); };
  }
  /* ⬆️／⬇️：已註冊自動同步的模組走同一個同步流程（忙碌鎖＋反灰）；否則沿用頁面自己的處理。 */
  function bindSync(id, kind, fallback) {
    var el = document.getElementById(id); if (!el) return;
    if (typeof fallback !== 'function' && !SEC_AUTO_UPLOADERS[HEADER_TOOL]) { el.hidden = true; }
    el.onclick = function (ev) {
      closeMenu();
      if (el.disabled) return;
      if (typeof SEC_AUTO_UPLOADERS[HEADER_TOOL] === 'function') { manualCloudSync(HEADER_TOOL, kind); return; }
      if (typeof fallback !== 'function') return;
      el.disabled = true;
      var out = run(fallback, ev);
      Promise.resolve(out).then(function () { el.disabled = false; }, function () { el.disabled = false; });
    };
  }
  bindSync('btnUp', 'upload', handlers.onUpload);
  bindSync('btnDown', 'download', handlers.onDownload);
  var si = document.getElementById('btnSmart');
  if (si && typeof handlers.onSmartImport === 'function') bindAction('btnSmart', handlers.onSmartImport);
  else if (si) si.style.display = 'none';
  var tg = document.getElementById('btnTg');
  if (tg && typeof handlers.onTelegram === 'function') bindAction('btnTg', handlers.onTelegram);
  else if (tg) tg.style.display = 'none';
  var cf = document.getElementById('btnCfg'); if (cf) cf.onclick = function () { closeMenu(); openSettings(); };
  var bar = document.getElementById('cloudBar');
  if (bar) bar.onclick = function () {
    /* 紅色（離線／未上雲）時點狀態列＝再試一次 */
    if ((SYNC_LAST.state === 'offline' || SYNC_LAST.state === 'retry') && SEC_AUTO_UPLOADERS[HEADER_TOOL]) manualCloudSync(HEADER_TOOL, 'upload');
  };
  if (!navigator.onLine) setAutoSyncState(HEADER_TOOL, 'offline');
  else paintSyncButtons();
  dataReady().then(function () { setLang(getCfg().lang || 'zh'); }).catch(function (e) { bootError(e); });
}

/* 如果頁面初始化或按鈕事件出錯，直接在畫面顯示原因，避免「完全沒反應」。 */
function bootError(e) {
  var msg = String(e && e.message || e || 'Unknown JavaScript error');
  try { console.error('[AC SEC]', e); } catch (_) {}
  var b = document.getElementById('secBootError');
  if (!b) {
    b = document.createElement('div'); b.id = 'secBootError';
    b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:99998;background:#991b1b;color:#fff;padding:11px 14px;border-radius:10px;font:600 12px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer';
    b.onclick = function () { if (b.parentNode) b.parentNode.removeChild(b); };
    document.body.appendChild(b);
  }
  b.innerHTML = '⚠️ ' + esc(L('程式錯誤：', 'Program error: ', 'កំហុសកម្មវិធី៖ ')) + esc(msg) + '<br><small>' +
    esc(L('請重新整理；若仍存在，請把這行文字截圖傳給管理員。（點一下關閉）', 'Please reload. If it continues, send a screenshot of this message to the administrator. (Tap to close)',
      'សូមផ្ទុកឡើងវិញ។ បើនៅតែមាន សូមថតអេក្រង់ផ្ញើទៅអ្នកគ្រប់គ្រង។ (ចុចដើម្បីបិទ)')) + '</small>';
}
try {
  G.addEventListener('error', function (ev) { if (ev && ev.error) bootError(ev.error); });
  G.addEventListener('unhandledrejection', function (ev) { if (ev && ev.reason) bootError(ev.reason); });
} catch (_) {}

/* ───────── 設定 Modal ─────────
   一般使用者只看到「你的名字」和「語言」。雲端網址等管理項目收在「進階」裡，
   而且留白就自動使用內建預設值——頁面不需要任何設定就能連線。 */
function openSettings() {
  var c = getCfg();
  var old = document.getElementById('secCfgMask'); if (old && old.parentNode) old.parentNode.removeChild(old);
  var m = document.createElement('div');
  m.id = 'secCfgMask'; m.className = 'mask';
  var langOpt = function (v, zh, en, km) { return '<option value="' + v + '"' + (_lang === v ? ' selected' : '') + '>' + esc(L(zh, en, km)) + '</option>'; };
  m.innerHTML =
    '<div class="modal"><div class="mh"><span>⚙️</span><b>' + esc(L('設定', 'Settings', 'ការកំណត់')) + '</b>' +
    '<button class="x" type="button" onclick="SEC.closeSettings()" aria-label="' + esc(T().close) + '">×</button></div>' +
    '<div class="mb"><div class="grid">' +
      '<div class="f"><label for="cfgOp">' + esc(L('你的名字', 'Your name', 'ឈ្មោះរបស់អ្នក')) + '</label><input id="cfgOp" autocomplete="name" placeholder="' +
        esc(L('例如：Sokha', 'e.g. Sokha', 'ឧ. សុខា')) + '"></div>' +
      '<div class="f"><label for="cfgLang">' + esc(L('語言', 'Language', 'ភាសា')) + '</label><select id="cfgLang">' +
        langOpt('zh', '繁體中文', 'Chinese (Traditional)', 'ភាសាចិន') + langOpt('en', 'English', 'English', 'អង់គ្លេស') + langOpt('km', 'ខ្មែរ（高棉文）', 'Khmer', 'ខ្មែរ') +
      '</select></div>' +
    '</div>' +
    '<button type="button" class="btn gh sm adv-toggle" id="cfgAdvBtn" aria-expanded="false"><span class="adv-arrow" aria-hidden="true">▸</span> ' + esc(L('進階（管理員）', 'Advanced (admin)', 'កម្រិតខ្ពស់ (អ្នកគ្រប់គ្រង)')) + '</button>' +
    '<div id="cfgAdv" hidden>' +
      '<div class="grid" style="margin-top:10px">' +
        '<div class="f"><label for="cfgGas">' + esc(L('雲端網址（留白＝使用內建）', 'Cloud URL (blank = built-in)', 'URL ពពក (ទទេ = លំនាំដើម)')) + '</label><input id="cfgGas" inputmode="url" autocomplete="off" spellcheck="false"></div>' +
        '<div class="f"><label for="cfgChat">' + esc(L('Telegram 群組 ID', 'Telegram group ID', 'លេខសម្គាល់ក្រុម Telegram')) + '</label><input id="cfgChat" autocomplete="off"></div>' +
        '<div class="f"><label for="cfgRoute">' + esc(L('預設核可路徑', 'Default approval route', 'ផ្លូវអនុម័តលំនាំដើម')) + '</label>' +
          '<select id="cfgRoute"><option value="review">👥 ' + esc(T().routeReview) + '</option>' +
          '<option value="direct">🚀 ' + esc(T().routeDirect) + '</option></select></div>' +
      '</div>' +
      '<div class="sep"></div>' +
      '<div class="row"><button type="button" class="btn gh sm" onclick="SEC.pingGas()">🔌 ' + esc(L('測試連線', 'Test connection', 'សាកល្បងការតភ្ជាប់')) + '</button>' +
      '<button type="button" class="btn gh sm" onclick="SEC.tgTest()">✈️ ' + esc(L('測試 Telegram', 'Test Telegram', 'សាកល្បង Telegram')) + '</button>' +
      '<button type="button" class="btn gh sm" onclick="SEC.sendMenu()">📱 ' + esc(L('推送模組選單', 'Push module menu', 'ផ្ញើម៉ឺនុយម៉ូឌុល')) + '</button></div>' +
      '<p class="hint" id="cfgStorage" style="margin-top:9px">' + esc(L('正在檢查本機儲存空間…', 'Checking phone storage…', 'កំពុងពិនិត្យទំហំផ្ទុក…')) + '</p>' +
    '</div>' +
    '</div><div class="mf"><button type="button" class="btn gray" onclick="SEC.closeSettings()">' + esc(T().cancel) + '</button>' +
    '<button type="button" class="btn" onclick="SEC.saveSettings()">' + esc(T().save) + '</button></div></div>';
  document.body.appendChild(m);
  document.getElementById('cfgGas').value  = c.gasUrl === DEFAULTS.gasUrl ? '' : c.gasUrl;
  document.getElementById('cfgGas').placeholder = L('內建預設', 'Built-in default', 'លំនាំដើម');
  document.getElementById('cfgChat').value = c.tgChat;
  document.getElementById('cfgOp').value   = c.operator;
  document.getElementById('cfgRoute').value= c.route || 'review';
  var advBtn = document.getElementById('cfgAdvBtn'), adv = document.getElementById('cfgAdv');
  advBtn.onclick = function () {
    adv.hidden = !adv.hidden;
    advBtn.setAttribute('aria-expanded', adv.hidden ? 'false' : 'true');
    advBtn.querySelector('.adv-arrow').textContent = adv.hidden ? '▸' : '▾';
  };
  m.onclick = function (e) { if (e.target === m) closeSettings(); };
  m.classList.add('on');
  storageEstimate().then(function (s) {
    var el = document.getElementById('cfgStorage'); if (!el) return;
    var u = Number(s.usage || 0), q = Number(s.quota || 0);
    el.textContent = q ? L('本機資料用量：', 'Phone data used: ', 'ទិន្នន័យក្នុងទូរស័ព្ទ៖ ') + (u / 1048576).toFixed(1) + ' MB / ' + (q / 1048576).toFixed(1) + ' MB'
      : L('本機資料存於瀏覽器資料庫（IndexedDB）。', 'Data is stored in the browser database (IndexedDB).', 'ទិន្នន័យរក្សាទុកក្នុងមូលដ្ឋានទិន្នន័យកម្មវិធីរុករក។');
  }).catch(function () {});
}
function closeSettings() { var m = document.getElementById('secCfgMask'); if (m) m.classList.remove('on'); }
function saveSettings() {
  var gas = document.getElementById('cfgGas'), chat = document.getElementById('cfgChat'), route = document.getElementById('cfgRoute');
  var next = { operator: document.getElementById('cfgOp').value.trim() };
  if (gas) next.gasUrl = gas.value.trim() || DEFAULTS.gasUrl;     /* 留白或錯誤 → 內建預設 */
  if (chat) next.tgChat = chat.value.trim();
  if (route) next.route = route.value;
  setCfg(next);
  var lg = document.getElementById('cfgLang');
  if (lg && lg.value && lg.value !== _lang) setLang(lg.value);
  closeSettings(); toast(L('✅ 設定已儲存', '✅ Settings saved', '✅ បានរក្សាទុកការកំណត់'), 'ok');
}
async function pingGas() {
  try { var r = await gasPost({ action:'ping' }); toast(L('✅ 雲端連線正常', '✅ Cloud connection OK', '✅ ការតភ្ជាប់ពពកល្អ') + ' ' + esc(r && r.ts || ''), 'ok'); return true; }
  catch (e) { toast('❌ ' + esc(e.message), 'err', 0, { label:retryLabel(), fn:pingGas }); return false; }
}
async function tgTest() {
  try { await gasPost({ action:'telegram', text:'🧪 <b>' + L('AC Security 連線測試', 'AC Security connection test', 'សាកល្បងការតភ្ជាប់ AC Security') + '</b>\n' + nowStr(), lang:_lang });
        toast(L('✅ 已送出，請看群組', '✅ Sent — check the group', '✅ បានផ្ញើ — សូមមើលក្រុម'), 'ok'); }
  catch (e) { toast('❌ ' + esc(e.message), 'err', 0); }
}
async function sendMenu() {
  try { await gasPost({ action:'secMenu', lang:_lang }); toast(L('✅ 選單已推送到群組', '✅ Menu sent to the group', '✅ បានផ្ញើម៉ឺនុយទៅក្រុម'), 'ok'); }
  catch (e) { toast('❌ ' + esc(e.message), 'err', 0); }
}

/* ───────── Modal 工具 ───────── */
function openModal(id) { var m = document.getElementById(id); if (m) m.classList.add('on'); }
function closeModal(id) { var m = document.getElementById(id); if (m) m.classList.remove('on'); }

/* ───────── 匯出 ───────── */
G.SEC = {
  CFG_KEY:CFG_KEY, getCfg:getCfg, setCfg:setCfg,
  p2:p2, ymd:ymd, hm:hm, nowStr:nowStr, parseD:parseD, parseTime:parseTime, num:num, str:str, esc:esc,
  closest:closest, bootError:bootError, safeStorageGet:safeStorageGet, safeStorageSet:safeStorageSet,
  dataReady:dataReady, dbGet:dbGet, dbPut:dbPut, storageEstimate:storageEstimate,
  Period:Period, periodNavHtml:periodNavHtml, bindPeriodNav:bindPeriodNav,
  T:T, L:L, lang:lang, setLang:setLang, applyI18n:applyI18n, I18N:BASE_I18N,
  toast:toast, gasPost:gasPost, cloudPush:cloudPush, cloudPull:cloudPull,
  registerAutoUploader:registerAutoUploader, registerAutoDownloader:registerAutoDownloader,
  scheduleAutoCloudSync:scheduleAutoCloudSync, retryAutoCloudSync:retryAutoCloudSync,
  startAutoCloudSync:startAutoCloudSync, runAutoCloudSync:runAutoCloudSync,
  setAutoSyncState:setAutoSyncState, markSync:markSync, lastSync:lastSync, tgSummary:tgSummary, tgOpen:tgOpen, TG:TG, tgSentFx:tgSentFx,
  manualCloudSync:manualCloudSync, syncBadge:syncBadge, autoSyncDebug:autoSyncDebug, isTransient:isTransient,
  noteNet:noteNet, netFailText:netFailText, photoSig:photoSig, i18nAttrs:i18nAttrs, DEFAULTS:{ gasUrl:DEFAULTS.gasUrl },
  recordKey:recordKey, mergeRecords:mergeRecords, mergeObject:mergeObject, dedupeBy:dedupeBy,
  replaceObject:replaceObject, unwrapObject:unwrapObject,
  getDeleted:deletedRows, markDeleted:markDeleted, markDeletedMany:markDeletedMany, clearDeleted:clearDeleted,
  clearDeletedMany:clearDeletedMany,
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
