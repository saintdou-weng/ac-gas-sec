/* AC Security smart incremental sync
 * Mirrors the HRA Pay v3.3 contract while keeping the existing AC SEC
 * full-payload endpoint as a safe fallback during deployment migration.
 * - manifest first
 * - changed month/hash buckets only
 * - cloud-only buckets are retained
 * - legacy tool.json/chunk snapshots are migrated once
 * - latest timestamp wins and blank values never erase non-blank values
 */
(function (g) {
  'use strict';
  var SEC = g.SEC;
  if (!SEC || SEC._smartSyncInstalled) return;
  SEC._smartSyncInstalled = true;

  var oldPush = SEC.cloudPush, oldPull = SEC.cloudPull;
  var PREFIX = 'ac_sec_smart_sync_v1_';

  function text(v) { return String(v == null ? '' : v); }
  function now() { return new Date().toISOString(); }
  function url() { return text((SEC.getCfg() || {}).gasUrl).trim(); }
  function esc(v) { return encodeURIComponent(text(v)); }
  function stateRead(tool) { try { return JSON.parse(localStorage.getItem(PREFIX + tool) || 'null'); } catch (e) { return null; } }
  function stateWrite(tool, value) { try { localStorage.setItem(PREFIX + tool, JSON.stringify(value)); } catch (e) {} }
  function statusDot(kind) { var d = document.querySelector('.c-dot'); if (d) d.className = 'c-dot ' + kind; }
  function unwrap(j) { return j && j.data !== undefined ? j.data : j; }
  function parseResponse(res) {
    return res.text().then(function (raw) {
      var j; try { j = JSON.parse(raw); } catch (e) { throw new Error('GAS 回傳不是 JSON：' + raw.slice(0, 120)); }
      if (!res.ok || (j && j.ok === false)) throw new Error((j && j.error) || ('HTTP ' + res.status));
      return unwrap(j);
    });
  }
  function get(action, tool, bucket) {
    var u = url(); if (!u) return Promise.reject(new Error('GAS URL missing'));
    var q = '?action=' + esc(action) + '&tool=' + esc(tool) + '&_=' + Date.now();
    if (bucket) q += '&bucket=' + esc(bucket);
    return fetch(u + q, { method:'GET', cache:'no-store' }).then(parseResponse);
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
  function rowDate(r) {
    var fields = ['month','period','periodKey','date','recordDate','reportDate','effectiveDate','effDate','last','checkDate','inspectionDate','yearMonth','ym','createdAt'];
    for (var i = 0; i < fields.length; i++) { var d = normDate(r && r[fields[i]]); if (d) return d; }
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
    var d = rowDate(r); if (d) return 'm:' + d.slice(0, 7);
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
  function buildBuckets(tool, records, extra) {
    var groups = {}, rows = withStamps(records);
    rows.forEach(function (r, i) { var k = bucketKey(tool, r, i); (groups[k] || (groups[k] = [])).push(r); });
    if (extra && typeof extra === 'object' && Object.keys(extra).length) {
      groups.__extra = [{ __smartExtra:true, extra:extra }];
    }
    var out = {};
    Object.keys(groups).sort().forEach(function (k) {
      var list = groups[k].slice().sort(function (a, b) {
        var ka = stable(a), kb = stable(b); return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      out[k] = { key:k, records:list, count:list.length, hash:hash(list) };
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
    var m = SEC.mergeRecords(tool, remote || [], local || []);
    var ex = SEC.mergeObject(remoteExtra || {}, localExtra || {});
    return { records:m.records, extra:ex };
  }
  async function legacyAll(tool) { return oldPull(tool); }
  async function manifest(tool) {
    var m = await get('smartManifest', tool);
    if (!m || (m.exists === undefined && m.legacy === undefined)) throw new Error('AC SEC smart sync endpoint not deployed');
    return m;
  }
  async function smartAll(tool, remote) {
    var rows = [], extra = {};
    var keys = Object.keys(remote.hashes || {}).sort();
    for (var i = 0; i < keys.length; i++) {
      var b = await get('smartBucket', tool, keys[i]);
      var x = extraFrom((b && b.records) || []); rows = rows.concat(x.records); if (Object.keys(x.extra).length) extra = x.extra;
    }
    return { records:rows, extra:extra, meta:remote.meta || {} };
  }
  function changedRemote(localBuckets, remote, state) {
    if (!state || !state.hashes) return true;
    var remoteH = remote.hashes || {}, keys = Object.keys(remoteH), last = state.hashes || {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], lh = localBuckets[k] && localBuckets[k].hash || '', rh = remoteH[k] || '';
      if (rh !== (last[k] || '') && lh !== rh) return true;
      if (rh !== (last[k] || '') && !lh) return true;
    }
    return false;
  }
  async function smartPush(tool, records, summary, extra, depth) {
    depth = depth || 0;
    statusDot('syncing');
    var remote = await manifest(tool), local = { records:normalizeRecords(tool, withStamps(records)), extra:extra || {} }, migrated = false;
    if (!remote.exists && remote.legacy) {
      var old = await legacyAll(tool), oldExtra = old && old._cloudExtra || {};
      local = mergeLocal(tool, local.records, normalizeRecords(tool, old || []), local.extra, oldExtra);
      local.records = normalizeRecords(tool, local.records);
      remote = { exists:false, hashes:{}, counts:{}, metaHash:'' }; migrated = true;
    }
    var buckets = buildBuckets(tool, local.records, local.extra), state = stateRead(tool);
    if (!migrated && remote.exists && (changedRemote(buckets, remote, state) || !state) && depth < 2) {
      var cloud = await smartAll(tool, remote);
      local = mergeLocal(tool, local.records, normalizeRecords(tool, cloud.records), local.extra, cloud.extra);
      local.records = normalizeRecords(tool, local.records);
      /* 雲端有新資料時先合併，再在同一輪提交；避免同一頁重複下載。 */
      remote = { exists:false, hashes:{}, counts:{}, metaHash:'' }; migrated = true;
    }
    buckets = buildBuckets(tool, local.records, local.extra);
    var remoteH = remote.hashes || {}, remoteC = remote.counts || {}, hashes = {}, counts = {}, changed = [];
    Object.keys(remoteH).forEach(function (k) { hashes[k] = remoteH[k]; counts[k] = Number(remoteC[k]) || 0; });
    Object.keys(buckets).forEach(function (k) {
      hashes[k] = buckets[k].hash; counts[k] = buckets[k].count;
      if (migrated || remoteH[k] !== buckets[k].hash) changed.push(k);
    });
    var meta = metaFor(tool, local.records, local.extra, summary), metaHash = hash(meta), uploadId = 'sec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    for (var i = 0; i < changed.length; i++) {
      var b = buckets[changed[i]];
      await post({ action:'smartBucket', tool:tool, uploadId:uploadId, bucket:b.key, hash:b.hash, count:b.count, records:b.records });
    }
    var recordCount = local.records.length;
    var metaChanged = migrated || metaHash !== (remote.metaHash || '');
    if (changed.length || metaChanged || !remote.exists) {
      var result = await post({ action:'smartCommit', tool:tool, uploadId:uploadId, hashes:hashes, counts:counts,
        recordCount:recordCount, meta:Object.assign({}, meta, {_smartMetaHash:metaHash}), summary:summary || {} });
      var stamp = result && (result.timestamp || result.updatedAt) || now();
      stateWrite(tool, { hashes:hashes, counts:counts, metaHash:metaHash, updatedAt:stamp });
      statusDot('ok');
      SEC.toast('☁️ 智慧上傳完成 / Smart cloud save complete' + (changed.length ? ' · ' + changed.length + ' 個變更區塊' : ''), 'ok', 4500);
    } else {
      stateWrite(tool, { hashes:hashes, counts:counts, metaHash:metaHash, updatedAt:now() });
      statusDot('ok');
      SEC.toast('☁️ 雲端已是最新，無需重傳 / Cloud already up to date', 'ok', 4000);
    }
    return true;
  }
  async function smartPull(tool) {
    statusDot('syncing');
    var remote = await manifest(tool);
    if (!remote.exists && remote.legacy) return legacyAll(tool);
    if (!remote.exists) { var empty = []; empty._cloudExtra = {}; empty._cloudMeta = {}; return empty; }
    var all = await smartAll(tool, remote), out = all.records;
    out._cloudExtra = all.extra; out._cloudMeta = remote.meta || {};
    stateWrite(tool, { hashes:remote.hashes || {}, counts:remote.counts || {}, metaHash:remote.metaHash || '', updatedAt:remote.updatedAt || now() });
    statusDot('ok');
    return out;
  }
  SEC.cloudPush = async function (tool, records, summary, extra) {
    try { return await smartPush(tool, records, summary, extra || {}); }
    catch (e) {
      console.warn('[AC SEC smart sync fallback]', e);
      SEC.toast('ℹ️ 智慧同步暫不可用，改用相容上傳 / Smart sync fallback', 'warn', 4500);
      return oldPush(tool, records, summary, extra);
    }
  };
  SEC.cloudPull = async function (tool) {
    try { return await smartPull(tool); }
    catch (e) {
      console.warn('[AC SEC smart download fallback]', e);
      SEC.toast('ℹ️ 智慧下載暫不可用，改用相容下載 / Smart download fallback', 'warn', 4500);
      return oldPull(tool);
    }
  };
  SEC.smartSyncState = function (tool) { return stateRead(tool); };
})(window);
