/* AC Security smart incremental sync
 * Mirrors the HRA Pay v3.3 contract while keeping the existing AC SEC
 * full-payload endpoint as a fallback ONLY when the backend has no smart
 * endpoints (never on a transient network error).
 * - manifest first
 * - download only buckets another device changed (cloud hash differs from the
 *   last cloud hash this browser incorporated); buckets changed only locally
 *   are never downloaded; if both changed → download + merge
 * - upload only buckets whose hash differs from the cloud
 * - buckets larger than ~1.5 MB of JSON are split into stable sub-buckets
 *   (non-master tools; master tools are re-bucketed by the backend)
 * - old buckets whose rows now live in other buckets (e.g. patrol punches
 *   moved from hash buckets to month buckets) are dropped after verification
 * - latest timestamp wins and blank values never erase non-blank values
 */
(function (g) {
  'use strict';
  var SEC = g.SEC;
  if (!SEC || SEC._smartSyncInstalled) return;
  SEC._smartSyncInstalled = true;

  var oldPush = SEC.cloudPush, oldPull = SEC.cloudPull;
  var PREFIX = 'ac_sec_smart_sync_v1_';
  /* 後端 secMasterCommit_ 會把這些工具的所有區塊重新合併、重新分桶。 */
  var MASTER = { personnel:1, fire:1, cctv:1 };
  var SPLIT_CHARS = 1500000, MAX_PARTS = 64;

  function L(zh, en, km) { return SEC.L ? SEC.L(zh, en, km) : en; }
  function text(v) { return String(v == null ? '' : v); }
  function now() { return new Date().toISOString(); }
  function url() { return text((SEC.getCfg() || {}).gasUrl).trim(); }
  function esc(v) { return encodeURIComponent(text(v)); }
  function hm() { try { return new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}); } catch (e) { return ''; } }
  function stateRead(tool) { try { return JSON.parse(localStorage.getItem(PREFIX + tool) || 'null'); } catch (e) { return null; } }
  function stateWrite(tool, value) { try { localStorage.setItem(PREFIX + tool, JSON.stringify(value)); } catch (e) {} }
  function statusDot(kind) { var d = document.querySelector('.c-dot'); if (d) d.className = 'c-dot ' + kind; }
  function unwrap(j) { return j && j.data !== undefined ? j.data : j; }
  function err(message, code, detail) { var e = new Error(message); e.code = code; if (detail) e.detail = detail; return e; }
  function noSmart() {
    return err(L('雲端尚未安裝智慧同步', 'Smart sync is not installed on the cloud', 'ពពកមិនទាន់មានការធ្វើសមកាលកម្មឆ្លាតវៃ'), 'NO_SMART');
  }
  function parseResponse(res) {
    return res.text().then(function (raw) {
      var j; try { j = JSON.parse(raw); } catch (e) {
        if (!res.ok) throw err(SEC.netFailText ? SEC.netFailText() : 'Network error', 'HTTP', 'HTTP ' + res.status);
        throw err(L('☁️ 雲端回覆格式錯誤，請稍後再試。', '☁️ The cloud sent an unexpected reply. Please try again later.',
          '☁️ ពពកឆ្លើយតបមិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀតពេលក្រោយ។'), 'FORMAT', raw.slice(0, 160));
      }
      if (!res.ok) throw err((j && j.error) || ('HTTP ' + res.status), 'HTTP');
      if (j && j.ok === false) throw err((j && j.error) || 'GAS error', 'GAS');
      return unwrap(j);
    });
  }
  function get(action, tool, bucket) {
    var u = url(); if (!u) return Promise.reject(noSmart());
    var q = '?action=' + esc(action) + '&tool=' + esc(tool) + '&_=' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (bucket) q += '&bucket=' + esc(bucket);
    return fetch(u + q, { method:'GET', cache:'no-store' }).then(parseResponse, function (e) {
      throw err(SEC.netFailText ? SEC.netFailText() : 'Network error', 'NETWORK', text(e && e.message || e));
    });
  }
  function post(body) { return SEC.gasPost(body); }

  function stable(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) {
      return !/^_smart/.test(k) && !/^(updatedAt|createdAt|savedAt|modifiedAt|timestamp|cloudUpdatedAt|lastCloudUpdatedAt)$/.test(k);
    }).map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    return JSON.stringify(text(v));
  }
  function fnv(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8) + '_' + s.length.toString(36);
  }
  function hash(v) { return fnv(stable(v)); }
  function normDate(v) {
    var s = text(v).trim(), m = s.match(/(20\d{2})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?/);
    if (m) return m[1] + '-' + ('0' + (+m[2])).slice(-2) + (m[3] ? '-' + ('0' + (+m[3])).slice(-2) : '');
    m = s.match(/(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})/);
    return m ? m[3] + '-' + ('0' + (+m[1])).slice(-2) + '-' + ('0' + (+m[2])).slice(-2) : '';
  }
  /* 't' = 巡更棒打點時間（2026-09-01 08:30:00）。有了它，打點按月份分區塊，
     匯入新月份時不會把全部歷史打點重傳一次。舊的雜湊區塊會在上傳時被驗證後淘汰。 */
  var DATE_FIELDS = ['month','period','periodKey','date','recordDate','reportDate','effectiveDate','effDate','last','checkDate','inspectionDate','yearMonth','ym','t','createdAt'];
  function rowDate(r, noT) {
    for (var i = 0; i < DATE_FIELDS.length; i++) {
      if (noT && DATE_FIELDS[i] === 't') continue;
      var d = normDate(r && r[DATE_FIELDS[i]]); if (d) return d;
    }
    return '';
  }
  function rowKey(tool, r, i) {
    try { return SEC.recordKey(tool, r, i); } catch (e) { return tool + '|row|' + i + '|' + stable(r); }
  }
  function normalizeRecords(tool, rows) {
    if (tool !== 'cctv') return Array.isArray(rows) ? rows : [];
    var out = [], seen = {};
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      r = r || {}; var vals = [r.code, r.name], hit = null;
      for (var i = 0; i < vals.length; i++) {
        var raw = text(vals[i]).trim().toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
        var m = raw.match(/^(?:CCTV|CAM(?:ERA)?)?\s*[-_ ]*([AB])\s*[-_ ]*([0-9]{1,3})$/);
        if (m && Number(m[2])) { hit = m[1] + '-' + Number(m[2]); break; }
      }
      if (!hit || seen[hit]) return;
      seen[hit] = 1;
      out.push(Object.assign({}, r, { code:'CCTV ' + hit.split('-')[0] + '-' + ('0' + hit.split('-')[1]).slice(-2) }));
    });
    return out.slice(0, 41);
  }
  function bucketKey(tool, r, i) {
    /* 主檔工具的分桶必須與後端 secPersonnelBucket_ 相同（後端沒有 't' 欄位）。 */
    var d = rowDate(r, !!MASTER[tool]);
    if (d) return 'm:' + d.slice(0, 7);
    return 'h:' + ('0' + (parseInt(fnv(rowKey(tool, r, i)), 16) % 32).toString(16)).slice(-2);
  }
  function withStamps(records) {
    var at = now();
    return (Array.isArray(records) ? records : []).map(function (r) {
      if (!r || typeof r !== 'object' || r.updatedAt) return r;
      return Object.assign({}, r, { updatedAt:at });
    });
  }
  function periods(value, out) {
    out = out || {};
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return out;
    if (Array.isArray(value)) { value.forEach(function (x) { periods(x, out); }); return out; }
    Object.keys(value).forEach(function (k) {
      var v = value[k];
      if (/^(updatedAt|modifiedAt|lastUpdated)$/.test(k)) return;
      if (/^(month|period|date|day|checkDate|inspectionDate|yearMonth|ym|createdAt|timestamp|last)$/.test(k)) {
        var m = text(v).match(/(20\d{2}-\d{2})(?:-\d{2})?/); if (m) out[m[1]] = true;
      }
      if (v && typeof v === 'object') periods(v, out);
    });
    return out;
  }
  function metaFor(tool, records, extra, summary) {
    var p = periods(records, {}); periods(extra, p); periods(summary, p);
    return { tool:tool, periods:Object.keys(p).sort() };
  }
  /* 排序時每筆只序列化一次（原本比較函式每次都重新序列化，大量打點很慢）。
     雜湊結果與舊版完全相同：hash(list) = fnv('[' + stable(each).join(',') + ']')。 */
  function sealed(key, items) {
    items.sort(function (a, b) { return a.s < b.s ? -1 : a.s > b.s ? 1 : 0; });
    var joined = '[' + items.map(function (x) { return x.s; }).join(',') + ']';
    return { key:key, records:items.map(function (x) { return x.r; }), count:items.length, hash:fnv(joined), size:joined.length };
  }
  function buildBuckets(tool, records, extra) {
    var groups = {}, rows = withStamps(records);
    rows.forEach(function (r, i) {
      var k = bucketKey(tool, r, i);
      (groups[k] || (groups[k] = [])).push({ r:r, s:stable(r), i:i });
    });
    if (extra && typeof extra === 'object' && Object.keys(extra).length) {
      var ex = { __smartExtra:true, extra:extra };
      groups.__extra = [{ r:ex, s:stable(ex), i:0 }];
    }
    var out = {};
    Object.keys(groups).sort().forEach(function (k) {
      var b = sealed(k, groups[k].slice());
      if (b.size <= SPLIT_CHARS || MASTER[tool] || k === '__extra') { out[k] = b; return; }
      /* 大區塊切成 2^n 個子區塊（依穩定鍵的雜湊），每個上傳請求都保持在 ~2MB 以下；
         內容不變時切法不變，所以只有真的改變的子區塊會重傳。 */
      var items = groups[k], parts = null;
      for (var n = 2; n <= MAX_PARTS; n *= 2) {
        var split = {};
        items.forEach(function (x) {
          var idx = parseInt(fnv(rowKey(tool, x.r, x.i)), 16) % n;
          (split[idx] || (split[idx] = [])).push(x);
        });
        parts = Object.keys(split).map(function (idx) { return sealed(k + '~' + n + '.' + idx, split[idx]); });
        if (parts.every(function (p) { return p.size <= SPLIT_CHARS; })) break;
      }
      parts.forEach(function (p) { out[p.key] = p; });
    });
    return out;
  }
  function extraFrom(rows) {
    var extra = {}, normal = [];
    (rows || []).forEach(function (r) {
      if (r && r.__smartExtra && r.extra) extra = r.extra; else normal.push(r);
    });
    return { records:normal, extra:extra };
  }
  function mergeLocal(tool, local, remote, localExtra, remoteExtra) {
    var m = SEC.mergeRecords(tool, remote || [], local || [], { keepTombstones:true });
    var ex = SEC.mergeObject(remoteExtra || {}, localExtra || {}, tool);
    return { records:m.records, extra:ex };
  }
  async function legacyAll(tool) { return oldPull(tool); }
  async function manifest(tool) {
    var m = await get('smartManifest', tool);
    if (!m || (m.exists === undefined && m.legacy === undefined)) throw noSmart();
    return m;
  }
  async function smartAll(tool, remote, wantedKeys) {
    var rows = [], extra = {}, missing = [], per = {};
    var keys = Array.isArray(wantedKeys) ? wantedKeys.slice().sort() : Object.keys(remote.hashes || {}).sort();
    for (var i = 0; i < keys.length; i++) {
      try {
        var b = await get('smartBucket', tool, keys[i]);
        var x = extraFrom((b && b.records) || []); per[keys[i]] = x.records;
        rows = rows.concat(x.records); if (Object.keys(x.extra).length) extra = x.extra;
      } catch (e) {
        if (e && (e.code === 'NETWORK' || e.code === 'HTTP')) throw e;   /* 斷網：整輪同步稍後重試 */
        missing.push(keys[i]);
      }
    }
    if (missing.length && !SEC._autoSyncSilent) SEC.toast(L('⚠️ 雲端有部分舊資料區塊遺失；已保留手機資料，下次上傳會自動修復。',
      '⚠️ Some old cloud data blocks are missing. Phone data was kept and the next upload will repair them.',
      '⚠️ ប្លុកទិន្នន័យចាស់មួយចំនួននៅលើពពកបាត់។ ទិន្នន័យក្នុងទូរស័ព្ទត្រូវបានរក្សា ហើយការផ្ទុកឡើងបន្ទាប់នឹងជួសជុល។'), 'warn', 6500);
    return { records:rows, extra:extra, meta:remote.meta || {}, missing:missing, perBucket:per };
  }
  function hashesOf(buckets) { var o = {}; Object.keys(buckets).forEach(function (k) { o[k] = buckets[k].hash; }); return o; }

  async function smartPush(tool, records, summary, extra) {
    statusDot('syncing');
    var live = Array.isArray(records) ? records.slice() : [];
    if (SEC.getDeleted) live = live.concat(SEC.getDeleted(tool));
    var remote = await manifest(tool), local = { records:normalizeRecords(tool, withStamps(live)), extra:extra || {} }, migrated = false;
    if (!remote.exists && remote.legacy) {
      var old = await legacyAll(tool);
      if (!old) throw err(SEC.netFailText ? SEC.netFailText() : 'Network error', 'NETWORK');
      var oldExtra = old._cloudExtra || {};
      local = mergeLocal(tool, local.records, normalizeRecords(tool, old || []), local.extra, oldExtra);
      local.records = normalizeRecords(tool, local.records);
      remote = { exists:false, hashes:{}, counts:{}, metaHash:'' }; migrated = true;
    }
    var state = stateRead(tool), previous = state && state.hashes || {}, remoteH = remote.hashes || {}, remoteC = remote.counts || {};
    var buckets = buildBuckets(tool, local.records, local.extra), pageHashes = hashesOf(buckets), fetched = {};
    if (!migrated && remote.exists) {
      /* 只下載「別台裝置改過」且內容與本機不同的區塊。 */
      var want = Object.keys(remoteH).filter(function (k) {
        return remoteH[k] !== (buckets[k] && buckets[k].hash) && (!state || previous[k] !== remoteH[k]);
      });
      if (want.length) {
        var cloud = await smartAll(tool, remote, want);
        fetched = cloud.perBucket;
        local = mergeLocal(tool, local.records, normalizeRecords(tool, cloud.records), local.extra, cloud.extra);
        local.records = normalizeRecords(tool, local.records);
        buckets = buildBuckets(tool, local.records, local.extra);
      }
    }
    /* 雲端貢獻了本機沒有的內容 → 這些區塊之後要讓頁面下載（needsPull）。 */
    var contributed = Object.keys(buckets).filter(function (k) { return pageHashes[k] !== buckets[k].hash; });
    var dropped = {}, checked = Object.assign({}, state && state.checked || {});
    if (!MASTER[tool] && remote.exists && !migrated) {
      var stale = Object.keys(remoteH).filter(function (k) { return !buckets[k] && k !== '__extra'; });
      if (stale.length) {
        var keySet = {};
        local.records.forEach(function (r, i) { keySet[rowKey(tool, r, i)] = 1; });
        var verify = stale.filter(function (k) { return fetched[k] || checked[k] !== remoteH[k]; });
        var need = verify.filter(function (k) { return !fetched[k]; });
        if (need.length) {
          var more = await smartAll(tool, remote, need);
          Object.keys(more.perBucket).forEach(function (k) { fetched[k] = more.perBucket[k]; });
        }
        verify.forEach(function (k) {
          var rows = fetched[k];
          if (!rows) return;
          /* 舊區塊的每一筆都已在本機（有效資料或刪除墓碑）→ 可以安全淘汰。 */
          if (rows.every(function (r, i) { return keySet[rowKey(tool, r, i)]; })) dropped[k] = true;
          else checked[k] = remoteH[k];
        });
      }
    }
    var hashes = {}, counts = {}, changed = [];
    Object.keys(remoteH).forEach(function (k) { if (!dropped[k]) { hashes[k] = remoteH[k]; counts[k] = Number(remoteC[k]) || 0; } });
    Object.keys(buckets).forEach(function (k) {
      hashes[k] = buckets[k].hash; counts[k] = buckets[k].count;
      if (migrated || remoteH[k] !== buckets[k].hash) changed.push(k);
    });
    Object.keys(checked).forEach(function (k) { if (!hashes[k] || hashes[k] !== checked[k]) delete checked[k]; });
    var meta = metaFor(tool, local.records, local.extra, summary), metaHash = hash(meta), uploadId = 'sec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    for (var i = 0; i < changed.length; i++) {
      var b = buckets[changed[i]];
      await post({ action:'smartBucket', tool:tool, uploadId:uploadId, bucket:b.key, hash:b.hash, count:b.count, records:b.records });
    }
    var recordCount = local.records.length, droppedKeys = Object.keys(dropped);
    var metaChanged = migrated || metaHash !== (remote.metaHash || '');
    var stamp = now();
    if (changed.length || metaChanged || !remote.exists || droppedKeys.length) {
      var result = await post({ action:'smartCommit', tool:tool, uploadId:uploadId, hashes:hashes, counts:counts,
        recordCount:recordCount, meta:Object.assign({}, meta, {_smartMetaHash:metaHash}), summary:summary || {} });
      stamp = result && (result.timestamp || result.updatedAt) || stamp;
      if (!SEC._autoSyncSilent) SEC.toast(L('☁️ 已上傳雲端', '☁️ Saved to the cloud', '☁️ បានរក្សាទុកក្នុងពពក') + (changed.length ? ' · ' + changed.length : ''), 'ok', 4000);
    } else if (!SEC._autoSyncSilent) {
      SEC.toast(L('☁️ 雲端已是最新，無需重傳', '☁️ The cloud is already up to date', '☁️ ពពកមានទិន្នន័យថ្មីបំផុតហើយ'), 'ok', 4000);
    }
    /* state.hashes = 「頁面本機已包含」的雲端版本。雲端貢獻的區塊記成舊值，下一次下載才會補給頁面。 */
    var nextHashes = migrated ? {} : Object.assign({}, hashes);
    if (!migrated) contributed.forEach(function (k) { nextHashes[k] = previous[k] || ''; });
    stateWrite(tool, { hashes:nextHashes, counts:counts, metaHash:metaHash, updatedAt:stamp, checked:checked,
      needsPull:migrated || contributed.length > 0 });
    statusDot('ok');
    SEC.markSync(tool);
    return true;
  }
  async function smartPull(tool, opts) {
    opts = opts || {};
    statusDot('syncing');
    var remote = await manifest(tool);
    if (!remote.exists && remote.legacy) {
      var legacy = await legacyAll(tool);
      if (!legacy) throw err(SEC.netFailText ? SEC.netFailText() : 'Network error', 'NETWORK');
      return legacy;
    }
    if (!remote.exists) { var empty = []; empty._cloudExtra = {}; empty._cloudMeta = {}; return empty; }
    var hasLocal = Array.isArray(opts.localRecords), state = stateRead(tool), previous = state && state.hashes || {};
    var pullLocal = hasLocal ? opts.localRecords.slice() : [];
    if (SEC.getDeleted) pullLocal = pullLocal.concat(SEC.getDeleted(tool));
    var localBuckets = hasLocal ? buildBuckets(tool, normalizeRecords(tool, pullLocal), opts.localExtra || {}) : {};
    var remoteHashes = remote.hashes || {};
    /* 下載條件：雲端內容與本機不同，且（別台裝置改過 或 本機根本沒有這個區塊 或 強制）。
       只有本機改過、雲端沒動的區塊不下載——上傳時會處理。 */
    var changedKeys = Object.keys(remoteHashes).filter(function (k) {
      var lh = localBuckets[k] && localBuckets[k].hash || '';
      if (opts.force) return true;                      /* 明確要求「全部重新下載」 */
      if (hasLocal && lh === remoteHashes[k]) return false;
      if (!state || previous[k] !== remoteHashes[k]) return true;
      return hasLocal && !lh;
    });
    if (!changedKeys.length) {
      var unchanged = [];
      unchanged._cloudExtra = {};
      unchanged._cloudMeta = Object.assign({}, remote.meta || {}, { unchanged:true, downloadedBuckets:0, missingBuckets:[] });
      stateWrite(tool, Object.assign({}, state || {}, { hashes:remoteHashes, counts:remote.counts || {}, metaHash:remote.metaHash || '', updatedAt:remote.updatedAt || now(), needsPull:false }));
      statusDot('ok'); SEC.markSync(tool); return unchanged;
    }
    var all = await smartAll(tool, remote, changedKeys), out = all.records;
    out._cloudExtra = all.extra; out._cloudMeta = Object.assign({}, remote.meta || {}, {
      downloadedBuckets:changedKeys.length,
      missingBuckets:(remote.missingBuckets || []).concat(all.missing || [])
    });
    var nextHashes = Object.assign({}, remoteHashes);
    (all.missing || []).forEach(function (k) { if (previous[k]) nextHashes[k] = previous[k]; else delete nextHashes[k]; });
    stateWrite(tool, Object.assign({}, state || {}, { hashes:nextHashes, counts:remote.counts || {}, metaHash:remote.metaHash || '', updatedAt:remote.updatedAt || now(), needsPull:false }));
    statusDot('ok'); SEC.markSync(tool);
    return out;
  }
  function failToast(e) {
    if (SEC._autoSyncSilent) return;
    var T = SEC.T ? SEC.T() : { cloudFail:'Cloud sync failed' };
    SEC.toast('❌ ' + T.cloudFail + ': ' + SEC.esc(e && e.message || e), 'err', 0);
  }
  SEC.cloudPush = async function (tool, records, summary, extra) {
    try {
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'syncing');
      var out = await smartPush(tool, records, summary, extra || {});
      if (SEC.noteNet) SEC.noteNet(tool, true);
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'synced', hm());
      return out;
    }
    catch (e) {
      if (e && e.code === 'NO_SMART') {
        /* 只有後端真的沒有智慧同步端點時才改用舊版完整上傳。 */
        console.warn('[AC SEC smart sync → legacy upload]', e);
        var legacyRows = Array.isArray(records) ? records.slice() : [];
        if (SEC.getDeleted) legacyRows = legacyRows.concat(SEC.getDeleted(tool));
        return await oldPush(tool, legacyRows, summary, extra);
      }
      console.warn('[AC SEC smart sync]', tool, e);
      if (SEC.noteNet) SEC.noteNet(tool, false, e);
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'retry');
      statusDot('err');
      failToast(e);
      return false;
    }
  };
  SEC.cloudPull = async function (tool, opts) {
    try {
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'syncing');
      var out = await smartPull(tool, opts || {});
      if (SEC.noteNet) SEC.noteNet(tool, true);
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'synced', hm());
      return out;
    }
    catch (e) {
      if (e && e.code === 'NO_SMART') {
        console.warn('[AC SEC smart download → legacy download]', e);
        return await oldPull(tool, opts || {});
      }
      console.warn('[AC SEC smart download]', tool, e);
      if (SEC.noteNet) SEC.noteNet(tool, false, e);
      if (SEC.setAutoSyncState) SEC.setAutoSyncState(tool, 'retry');
      statusDot('err');
      failToast(e);
      return null;
    }
  };
  SEC.smartSyncState = function (tool) { return stateRead(tool); };
  /* 測試／診斷用：建立與上傳相同的區塊（不會連網）。 */
  SEC.smartBuckets = function (tool, records, extra) { return buildBuckets(tool, normalizeRecords(tool, records || []), extra || {}); };
  SEC.smartSyncConfig = function (o) { if (o && o.splitChars) SPLIT_CHARS = Number(o.splitChars) || SPLIT_CHARS; return { splitChars:SPLIT_CHARS, maxParts:MAX_PARTS }; };
})(window);
