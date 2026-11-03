/* ac-holidays.js — 國定假日／工作日（AC SEC 與 GASCheck 共用）2026-11-03
   來源：HRA Portal 行事曆（Paul 選的）。
   1) 同網域 localStorage 'ac_hra_calendar_db'（HRA 行事曆頁存的扁平清單）
   2) 本機快取 'ac_holidays_cache_v2'（12 小時）
   3) HRA GAS smartManifest/smartBucket tool=calendar（s:snapshot → records[0].db[year][]）
   規則同 HRA shared/calendar-model.js holidayDates：off 類型（legal/regular/substitute/annual/makeup/halfpay/vrt/stopwork）
   扣掉 workday/cancelled/postponed；countsAsHoliday===false 或 appliesTo==='partial' 不算。
   週日永遠休息；週六視為工作日（工廠週一～六上班）。 */
(function (root) {
  'use strict';
  var HRA_GAS = 'https://script.google.com/macros/s/AKfycbya4jZG7YixRmumt9vKA-5Cv92jP8fi_o4toiU-8J2exQCYBhBsLOtN4kX9hoKqzp12/exec';
  var LS_FLAT = 'ac_hra_calendar_db', LS_CACHE = 'ac_holidays_cache_v2', TTL = 12 * 3600 * 1000;
  var OFF = { legal:1, regular:1, substitute:1, annual:1, makeup:1, halfpay:1, vrt:1, stopwork:1 };
  var WORK = { workday:1, cancelled:1, postponed:1 };
  var state = { set:new Set(), names:{}, source:'', loadedAt:0, ready:null };

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function days(start, end) { var a = parse(start), b = parse(end || start), out = []; if (!a || !b || a > b) return out; for (var d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) out.push(iso(d)); return out; }
  function flatten(db) {
    if (Array.isArray(db)) return db;
    var out = [];
    if (db && typeof db === 'object') Object.keys(db).forEach(function (y) { if (Array.isArray(db[y])) out = out.concat(db[y]); });
    return out;
  }
  function compute(rows) {
    var off = new Set(), work = new Set(), names = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.date) return;
      var ds = days(r.date, r.enddate || r.date);
      if (r.countsAsHoliday !== false && r.appliesTo !== 'partial' && OFF[r.type]) ds.forEach(function (d) { off.add(d); names[d] = { zh:r.zh || '', en:r.en || '', km:r.km || '', type:r.type }; });
      if (WORK[r.type]) ds.forEach(function (d) { work.add(d); });
    });
    work.forEach(function (d) { off.delete(d); delete names[d]; });
    return { set:off, names:names };
  }
  function apply(rows, source) {
    var c = compute(rows);
    if (!c.set.size && state.set.size) return false;
    state.set = c.set; state.names = c.names; state.source = source; state.loadedAt = Date.now();
    return true;
  }
  function readLocalFlat() {
    try { var v = JSON.parse(localStorage.getItem(LS_FLAT) || 'null'); var rows = flatten(v); return rows.length ? rows : null; } catch (e) { return null; }
  }
  function readCache() {
    try { var c = JSON.parse(localStorage.getItem(LS_CACHE) || 'null'); if (c && Array.isArray(c.rows) && c.rows.length) return c; } catch (e) {}
    return null;
  }
  function writeCache(rows) { try { localStorage.setItem(LS_CACHE, JSON.stringify({ at:Date.now(), rows:rows })); } catch (e) {} }
  function gasUrl() {
    try { var u = localStorage.getItem('ac_hra_gas_url') || localStorage.getItem('vrt_att_cloud_v1_url'); if (/^https:\/\/script\.google\.com\/macros\/s\//.test(u || '')) return u; } catch (e) {}
    return HRA_GAS;
  }
  function fetchJson(url, ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null, t = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 20000) : null;
    return fetch(url, ctrl ? { signal:ctrl.signal } : {}).then(function (r) { return r.json(); }).finally(function () { if (t) clearTimeout(t); });
  }
  /* 只抓行事曆快照這一包（通常 1 筆，約 120KB），不經過各平台的同步機制 */
  function fetchRemote() {
    var u = gasUrl(), sep = u.indexOf('?') >= 0 ? '&' : '?';
    return fetchJson(u + sep + 'action=smartManifest&tool=calendar&_t=' + Date.now()).then(function (j) {
      var d = j && (j.data || j), hashes = d && d.hashes || {}, keys = Object.keys(hashes);
      if (!keys.length) throw new Error('calendar manifest empty');
      var k = keys.indexOf('s:snapshot') >= 0 ? 's:snapshot' : keys[0];
      return fetchJson(u + sep + 'action=smartBucket&tool=calendar&bucket=' + encodeURIComponent(k) + '&_t=' + Date.now());
    }).then(function (j) {
      var d = j && (j.data || j), rec = (d && d.records || [])[0] || {};
      var rows = flatten(rec.db || rec.rows || d.records);
      if (!rows.length) throw new Error('calendar snapshot empty');
      return rows;
    });
  }
  /* 載入順序：本機行事曆 → 快取 → 雲端；本機／快取可用時雲端在背景更新。回傳 Promise<Set> */
  function load(opts) {
    opts = opts || {};
    if (state.ready && !opts.force) return state.ready;
    var local = readLocalFlat(), cache = readCache(), fresh = cache && (Date.now() - cache.at) < TTL;
    if (local) apply(local, 'hra-local');
    else if (cache) apply(cache.rows, 'cache');
    var needRemote = opts.force || (!local && !fresh);
    var p = needRemote && typeof fetch === 'function' ? fetchRemote().then(function (rows) { if (apply(rows, 'hra-gas')) writeCache(rows); return state.set; }).catch(function () { return state.set; }) : Promise.resolve(state.set);
    state.ready = p.then(function () { return state.set; });
    return state.ready;
  }
  function has(ymd) { return state.set.has(String(ymd || '').slice(0, 10)); }
  function isSunday(ymd) { var d = parse(ymd); return !!d && d.getDay() === 0; }
  /* 休息日 = 週日或國定假日（含 VRT 廠假、調休）；調休上班日（workday）算工作日 */
  function isOff(ymd) { return isSunday(ymd) || has(ymd); }
  function workdays(from, to) { return days(from, to).filter(function (d) { return !isOff(d); }); }
  function name(ymd, lang) { var n = state.names[String(ymd || '').slice(0, 10)]; if (!n) return ''; return lang === 'en' ? (n.en || n.zh) : lang === 'km' ? (n.km || n.en || n.zh) : (n.zh || n.en); }
  function info() { return { source:state.source, count:state.set.size, loadedAt:state.loadedAt }; }
  root.ACHolidays = { load:load, has:has, isOff:isOff, isSunday:isSunday, workdays:workdays, days:days, name:name, info:info, compute:compute, _state:state };
})(typeof window !== 'undefined' ? window : this);
