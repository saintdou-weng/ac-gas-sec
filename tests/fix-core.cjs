/* fix-core: shared engine regression tests (token removal, zero-config URL, Excel dates in
   Asia/Phnom_Penh, SEC.parseTime, smart sync download/upload rules, bucket split, patrol month
   buckets, deletion ledger, IndexedDB failure, cloud status, manual sync guard, resume throttle,
   asset photo de-duplication, Telegram modal, i18n of shared UI) + real Chromium 390x844 checks. */
'use strict';
if (process.env.TZ !== 'Asia/Phnom_Penh') {
  const r = require('child_process').spawnSync(process.execPath, [__filename], { stdio:'inherit', env:Object.assign({}, process.env, { TZ:'Asia/Phnom_Penh' }) });
  process.exit(r.status == null ? 1 : r.status);
}
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const CJK = /[㐀-鿿豈-﫿]/;
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function pass(msg) { passed++; console.log('PASS: ' + msg); }

/* ───────── fake GAS backend (smart manifest/bucket/commit + legacy push/pull) ───────── */
function fakeServer(opt) {
  opt = opt || {};
  const S = { smart:opt.smart !== false, manifests:{}, staged:{}, legacy:{}, log:[], down:false, delay:0, telegram:[] };
  const ok = data => ({ ok:true, data });
  function get(p) {
    if (!S.smart) return ok({ message:'AC_SEC_CloudSync v2.0' });
    const m = S.manifests[p.tool];
    if (p.action === 'smartManifest') {
      if (!m) return ok({ tool:p.tool, exists:false, legacy:!!S.legacy[p.tool] });
      const hashes = {}, counts = {};
      Object.keys(m.buckets).forEach(k => { hashes[k] = m.buckets[k].hash; counts[k] = m.buckets[k].count; });
      return ok({ tool:p.tool, exists:true, hashes, counts, metaHash:m.metaHash, meta:m.meta, updatedAt:m.updatedAt, missingBuckets:[] });
    }
    if (p.action === 'smartBucket') {
      const b = m && m.buckets[p.bucket];
      if (!b) return { ok:false, error:'Smart bucket not found: ' + p.bucket };
      return ok({ records:JSON.parse(S.staged[b.source + '|' + p.bucket]) });
    }
    if (p.action === 'pull') return ok(S.legacy[p.tool] || { records:[] });
    return ok({ message:'AC_SEC_CloudSync v2.0' });
  }
  function post(b) {
    if (b.action === 'ping') return ok({ ok:true, ts:'now' });
    if (b.action === 'telegramBatch' || b.action === 'telegram') { S.telegram.push(b); return ok({ sent:true, sentPages:(b.pages || [1]).length }); }
    if (b.action === 'push') { const cur = S.legacy[b.tool] || { records:[] }; S.legacy[b.tool] = { records:cur.records.concat(b.records || []), extra:b.extra || {} }; return ok({ saved:true }); }
    if (b.action === 'pull') return ok(S.legacy[b.tool] || { records:[] });
    if (!S.smart) return { ok:false, error:'Unknown action: ' + b.action };
    if (b.action === 'smartBucket') { S.staged[b.uploadId + '|' + b.bucket] = JSON.stringify(b.records); return ok({ saved:'smartBucket' }); }
    if (b.action === 'smartCommit') {
      const old = S.manifests[b.tool] || { buckets:{} }, next = {};
      Object.keys(b.hashes).forEach(k => {
        const h = b.hashes[k], prior = old.buckets[k];
        if (prior && prior.hash === h) next[k] = prior;
        else {
          if (!S.staged[b.uploadId + '|' + k]) throw new Error('Missing staged smart bucket: ' + k);
          next[k] = { hash:h, count:b.counts[k], source:b.uploadId };
        }
      });
      S.manifests[b.tool] = { buckets:next, metaHash:b.meta._smartMetaHash, meta:b.meta, updatedAt:new Date().toISOString() };
      return ok({ saved:'smartCommit', timestamp:new Date().toISOString() });
    }
    return { ok:false, error:'Unknown action: ' + b.action };
  }
  S.fetch = async (url, o) => {
    o = o || {};
    if (S.delay) await sleep(S.delay);
    if (S.down) throw new TypeError('Failed to fetch');
    let out;
    if (o.method === 'POST') { const body = JSON.parse(o.body); S.log.push({ m:'POST', action:body.action, bucket:body.bucket, size:o.body.length, n:(body.records || []).length }); try { out = post(body); } catch (e) { out = { ok:false, error:String(e.message) }; } }
    else { const u = new URL(url), p = Object.fromEntries(u.searchParams); S.log.push({ m:'GET', action:p.action, bucket:p.bucket }); out = get(p); }
    return { ok:true, status:200, text:async () => JSON.stringify(out) };
  };
  S.count = (m, action) => S.log.filter(x => x.m === m && x.action === action).length;
  S.reset = () => { S.log.length = 0; };
  S.all = tool => { const m = S.manifests[tool]; if (!m) return []; return [].concat(...Object.keys(m.buckets).map(k => JSON.parse(S.staged[m.buckets[k].source + '|' + k]))); };
  return S;
}

/* ───────── jsdom window with shared scripts ───────── */
async function makeWin(o) {
  o = o || {};
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errors.push(e.message); });
  const dom = new JSDOM('<!doctype html><html><body><div id="hdr"></div><div id="toastwrap"></div></body></html>',
    { url:'https://offline.test/' + (o.name || 'x') + '.html', runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:vc });
  const w = dom.window;
  w.confirm = () => true; w.alert = () => {};
  w.fetch = async () => { throw new TypeError('Failed to fetch'); };
  if (o.before) o.before(w);
  const ctx = dom.getInternalVMContext();
  for (const f of (o.scripts || ['shared/sec-core.js', 'shared/sec-smart-sync.js', 'shared/sec-asset-changes.js', 'shared/sec-personnel.js']))
    vm.runInContext(read(f), ctx, { filename:f });
  w.console.warn = () => {}; w.console.error = (...a) => errors.push(a.join(' '));
  await w.SEC.dataReady();
  return { w, errors, dom };
}
function allText(el) {
  const w = el.ownerDocument.defaultView, out = [];
  const walk = n => {
    if (n.nodeType === 3) out.push(n.nodeValue);
    if (n.nodeType !== 1) return;
    ['title', 'placeholder', 'aria-label', 'label'].forEach(a => { if (n.getAttribute(a)) out.push(n.getAttribute(a)); });
    n.childNodes.forEach(walk);
  };
  walk(el);
  return out.join('\n');
}

(async () => {
  /* 1. Token removed, zero-config GAS URL, settings modal */
  {
    const { w } = await makeWin({ before:w => w.localStorage.setItem('ac_sec_config', JSON.stringify({ gasUrl:'', tgToken:'123:SECRET', operator:'Sokha', lang:'zh' })) });
    const src = read('shared/sec-core.js');
    assert(!/\d{8,}:AA[A-Za-z0-9_-]{20,}/.test(src), 'no bot token in sec-core.js');
    assert(!/tgToken\s*:/.test(src) && !/cfgTok/.test(src), 'no tgToken field / cfgTok input');
    assert(!JSON.parse(w.localStorage.getItem('ac_sec_config')).tgToken, 'stored tgToken purged on load');
    const c = w.SEC.getCfg();
    assert.equal(c.tgToken, undefined); assert(/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(c.gasUrl), 'empty stored URL → built-in default');
    w.SEC.setCfg({ gasUrl:'not a url' }); assert.equal(w.SEC.getCfg().gasUrl, c.gasUrl, 'invalid URL → built-in default');
    w.SEC.openSettings();
    const m = w.document.getElementById('secCfgMask');
    assert(!m.querySelector('#cfgTok'));
    assert(m.querySelector('#cfgAdv').hidden && m.querySelector('#cfgAdv #cfgGas'), 'GAS URL hidden behind Advanced');
    assert(!m.querySelector('#cfgOp').closest('[hidden]') && !m.querySelector('#cfgLang').closest('[hidden]'), 'operator + language visible');
    m.querySelector('#cfgOp').value = 'Dara'; m.querySelector('#cfgLang').value = 'en'; w.SEC.saveSettings();
    assert.equal(w.SEC.getCfg().operator, 'Dara'); assert.equal(w.SEC.lang(), 'en'); assert.equal(w.SEC.getCfg().gasUrl, c.gasUrl);
    assert(!/請先填|GAS URL/.test(w.document.body.textContent));
    let called = '';
    w.fetch = async (u) => { called = u; return { ok:true, status:200, text:async () => '{"ok":true,"data":{"ts":"x"}}' }; };
    await w.SEC.gasPost({ action:'ping' }); assert.equal(called, c.gasUrl);
    pass('Telegram token removed (source, defaults, stored config, settings); empty/invalid URL uses built-in default; normal settings show only name + language');
  }

  /* 2. Excel dates: real .xlsx written by SheetJS, read in Asia/Phnom_Penh */
  {
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Asia/Phnom_Penh');
    const { w } = await makeWin({ scripts:['shared/xlsx.full.min.js', 'shared/sec-core.js'] });
    const X = w.XLSX, S = w.SEC;
    const aoa = [['Date', 'DateTime', 'Time', 'Text date', 'DMY'],
      [new w.Date(2026, 0, 2), new w.Date(2026, 8, 1, 8, 30), new w.Date(1899, 11, 30, 8, 30), '2026-09-30', '22/8/2017'],
      [new w.Date(2026, 8, 30), new w.Date(2026, 11, 31, 23, 59), new w.Date(1899, 11, 30, 17, 45), '2026/1/5', '2/1/2026']];
    const ws = X.utils.aoa_to_sheet(aoa, { cellDates:true, dateNF:'yyyy-mm-dd' });
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'S1');
    const buf = X.write(wb, { type:'array', bookType:'xlsx', cellDates:true });
    fs.writeFileSync(path.join(require('os').tmpdir(), 'fix-core-dates.xlsx'), Buffer.from(buf));
    const file = new w.File([new w.Uint8Array(buf)], 'dates.xlsx');
    const sheets = await new Promise((res, rej) => { S.readWorkbook(file, s => res(s)); setTimeout(() => rej(new Error('readWorkbook timeout')), 4000); });
    const rows = sheets[0].rows;
    assert.equal(typeof rows[1][0], 'number', 'dates arrive as Excel serial numbers (cellDates:false, raw:true)');
    assert.equal(S.ymd(S.parseD(rows[1][0])), '2026-01-02'); assert.equal(S.ymd(S.parseD(rows[2][0])), '2026-09-30');
    assert.equal(S.ymd(S.parseD(rows[1][1])), '2026-09-01'); assert.equal(S.parseTime(rows[1][1]), '08:30');
    assert.equal(S.ymd(S.parseD(rows[2][1])), '2026-12-31'); assert.equal(S.parseTime(rows[2][1]), '23:59');
    assert.equal(S.parseTime(rows[1][2]), '08:30'); assert.equal(S.parseTime(rows[2][2]), '17:45');
    assert.equal(S.ymd(S.parseD(rows[1][3])), '2026-09-30'); assert.equal(S.ymd(S.parseD(rows[2][3])), '2026-01-05');
    assert.equal(S.ymd(S.parseD(rows[1][4])), '2017-08-22'); assert.equal(S.ymd(S.parseD(rows[2][4])), '2026-01-02');
    const parsed = S.parseSheet(rows, { date:['Date'], dt:['DateTime'] }, { minScore:1 });
    assert.deepEqual(copy(parsed.rows.map(r => r.date)), ['2026-01-02', '2026-09-30'], 'parseSheet converts serial dates');
    // parseD / parseTime unit cases
    assert.equal(S.ymd(S.parseD(46266)), '2026-09-01'); assert.equal(S.ymd(S.parseD(46266.99999)), '2026-09-01'); assert.equal(S.ymd(S.parseD('46266')), '2026-09-01');
    assert.equal(S.ymd(S.parseD(new w.Date(2026, 0, 1, 23, 59, 56))), '2026-01-02', 'old cellDates Date 4s early is rounded');
    const T = S.parseTime;
    [[0.354166666, '08:30'], [0.5, '12:00'], [0.99999, '00:00'], [46266.354166, '08:30'], ['8:30', '08:30'], ['08:30:59', '08:30'], ['8:05 PM', '20:05'],
     ['12:10 am', '00:10'], ['下午 3:05', '15:05'], ['0830', '08:30'], [1745, '17:45'], ['2026-09-01 07:15:00', '07:15'], ['8.30', '08:30'], ['0.75', '18:00'],
     [new w.Date(2026, 0, 1, 6, 59, 58), '07:00'], ['', ''], ['abc', ''], ['25:00', '']].forEach(([v, e]) => assert.equal(T(v), e, 'parseTime(' + v + ')'));
    assert(/cellDates:false/.test(read('shared/sec-core.js').match(/XLSX\.read\([\s\S]{0,200}/)[0]));
    pass('real SheetJS .xlsx date/date-time/time cells read with cellDates:false,raw:true in Asia/Phnom_Penh: no off-by-one; SEC.parseTime handles fractions, serials, strings, AM/PM');
  }

  /* 3a. Smart pull downloads only buckets another device changed */
  const T0 = '2026-09-01T00:00:00.000Z';
  const rec = (id, date, v, at) => ({ id, date, amount:v, note:'n' + id, updatedAt:at || T0 });
  {
    const srv = fakeServer();
    const A = await makeWin({ name:'A' }), B = await makeWin({ name:'B' });
    A.w.fetch = srv.fetch; B.w.fetch = srv.fetch;
    let aRecs = [rec('1', '2026-08-03', 1), rec('2', '2026-09-03', 2), rec('3', '2026-09-04', 3)], bRecs = [];
    const pull = async (d, recs, force) => { const r = await d.w.SEC.cloudPull('expense', { localRecords:recs, force }); if (!r) return null; return r._cloudMeta.unchanged ? recs : d.w.SEC.mergeRecords('expense', recs, Array.from(r)).records.map(copy); };
    assert(await A.w.SEC.cloudPush('expense', copy(aRecs)));
    assert.deepEqual(Object.keys(srv.manifests.expense.buckets).sort(), ['m:2026-08', 'm:2026-09']);
    // A changes a record locally only → pull downloads nothing; push uploads one bucket
    aRecs[0] = rec('1', '2026-08-03', 11, '2026-09-02T00:00:00.000Z'); srv.reset();
    aRecs = await pull(A, aRecs);
    assert.equal(srv.count('GET', 'smartBucket'), 0, 'local-only change is not downloaded');
    assert(await A.w.SEC.cloudPush('expense', copy(aRecs)));
    assert.equal(srv.count('POST', 'smartBucket'), 1, 'only the changed bucket is uploaded');
    // B (new device) downloads everything once
    srv.reset(); bRecs = await pull(B, bRecs); assert.equal(srv.count('GET', 'smartBucket'), 2); assert.equal(bRecs.length, 3);
    // B adds a September record → A downloads only September
    bRecs.push(rec('4', '2026-09-20', 4, '2026-09-03T00:00:00.000Z')); assert(await B.w.SEC.cloudPush('expense', copy(bRecs)));
    srv.reset(); aRecs = await pull(A, aRecs);
    assert.deepEqual(srv.log.filter(x => x.action === 'smartBucket').map(x => x.bucket), ['m:2026-09'], 'only the bucket changed by the other device');
    assert.equal(aRecs.length, 4);
    // nothing changed anywhere → manifest only
    srv.reset(); aRecs = await pull(A, aRecs); assert.equal(srv.count('GET', 'smartBucket'), 0); assert.equal(srv.count('GET', 'smartManifest'), 1);
    // both changed the same bucket → download + merge, both edits survive
    aRecs = aRecs.map(r => r.id === '2' ? rec('2', '2026-09-03', 22, '2026-09-05T00:00:00.000Z') : r);
    bRecs = (await pull(B, bRecs)).map(r => r.id === '3' ? rec('3', '2026-09-04', 33, '2026-09-05T00:00:00.000Z') : r);
    assert(await B.w.SEC.cloudPush('expense', copy(bRecs)));
    let aState = aRecs;
    A.w.SEC.registerAutoDownloader('expense', async () => { const r = await pull(A, aState); if (!r) return false; aState = r; return true; });
    A.w.SEC.registerAutoUploader('expense', async () => A.w.SEC.cloudPush('expense', copy(aState)));
    srv.reset(); assert(await A.w.SEC.runAutoCloudSync('expense', { reason:'test' }));
    assert.deepEqual(srv.log.filter(x => x.m === 'GET' && x.action === 'smartBucket').map(x => x.bucket), ['m:2026-09']);
    const cloud = srv.all('expense'), by = Object.fromEntries(cloud.map(r => [r.id, r.amount]));
    assert.deepEqual(by, { 1:11, 2:22, 3:33, 4:4 }, 'both devices\' edits merged in the cloud');
    // push without a preceding pull merges the other device's bucket and asks for a follow-up pull
    bRecs = (await pull(B, bRecs)); bRecs.push(rec('5', '2026-09-21', 5, '2026-09-06T00:00:00.000Z')); assert(await B.w.SEC.cloudPush('expense', copy(bRecs)));
    aState.push(rec('6', '2026-08-21', 6, '2026-09-06T00:00:00.000Z')); assert(await A.w.SEC.cloudPush('expense', copy(aState)));
    assert.equal(A.w.SEC.smartSyncState('expense').needsPull, true, 'merged-in cloud rows are flagged for the page');
    srv.reset(); aState = await pull(A, aState); assert(aState.some(r => r.id === '5'), 'page receives the other device rows');
    assert.equal(srv.all('expense').length, 6);
    pass('smart pull downloads only buckets changed by another device (not local-only changes); both-changed buckets download+merge; upload sends only changed buckets; push-side merges trigger a follow-up pull');
  }

  /* 3b. Oversized bucket is split; unchanged parts are not re-uploaded. 3e. legacy only when no smart backend. */
  {
    const srv = fakeServer(); const { w } = await makeWin(); w.fetch = srv.fetch;
    w.SEC.smartSyncConfig({ splitChars:6000 });
    const big = Array.from({ length:240 }, (_, i) => rec('B' + i, '2026-09-' + String(1 + i % 28).padStart(2, '0'), i));
    assert(await w.SEC.cloudPush('expense', copy(big)));
    const keys = Object.keys(srv.manifests.expense.buckets);
    assert(keys.length > 1 && keys.every(k => /^m:2026-09~\d+\.\d+$/.test(k)), 'large month bucket split into stable parts: ' + keys.join(','));
    assert(srv.log.filter(x => x.action === 'smartBucket').every(x => x.size < 6000 * 1.8), 'each request stays small');
    assert.equal(srv.all('expense').length, 240);
    big[7].amount = 999; big[7].updatedAt = '2026-09-09T00:00:00.000Z'; srv.reset();
    assert(await w.SEC.cloudPush('expense', copy(big)));
    assert.equal(srv.count('POST', 'smartBucket'), 1, 'one changed record re-uploads one part only');
    assert.equal(srv.all('expense').length, 240);

    const legacySrv = fakeServer({ smart:false }); w.fetch = legacySrv.fetch;
    assert(await w.SEC.cloudPush('expense', [rec('L1', '2026-09-01', 1)]));
    assert.equal(legacySrv.count('POST', 'push'), 1, 'backend without smart endpoints → legacy upload');
    const downSrv = fakeServer(); downSrv.down = true; w.fetch = downSrv.fetch;
    assert.equal(await w.SEC.cloudPush('expense', [rec('L2', '2026-09-01', 1)]), false);
    assert.equal(downSrv.log.length, 0); assert.equal(Object.keys(downSrv.legacy).length, 0, 'transient network error never falls back to legacy full upload');
    pass('oversized bucket split into stable ~request-size parts (only the changed part re-uploads); legacy full upload only when the backend lacks smart endpoints, never on network errors');
  }

  /* 3h. Patrol punches bucket by month ('t'); old hash buckets are superseded without data loss */
  {
    const srv = fakeServer(); const { w } = await makeWin(); w.fetch = srv.fetch;
    const scans = Array.from({ length:30 }, (_, i) => ({ _k:'scan', t:'2026-0' + (8 + (i % 2)) + '-' + String(1 + (i % 27)).padStart(2, '0') + ' 0' + (i % 9) + ':1' + (i % 6) + ':00', g:'Guard', c:'CP' + i, e:'D', r:'' }));
    const bk = w.SEC.smartBuckets('patrol', scans);
    assert.deepEqual(Object.keys(bk).sort(), ['m:2026-08', 'm:2026-09'], 'punches bucket by month of t');
    // simulate the old client: all punches stored in a hash bucket this device already synced
    const extraOld = { _k:'scan', t:'2026-07-31 23:00:00', g:'Other', c:'CPX', e:'N', r:'' };
    srv.staged['old|h:05'] = JSON.stringify(scans); srv.staged['old|h:06'] = JSON.stringify([extraOld]);
    srv.manifests.patrol = { buckets:{ 'h:05':{ hash:'oldhash5', count:30, source:'old' }, 'h:06':{ hash:'oldhash6', count:1, source:'old' } }, metaHash:'', meta:{}, updatedAt:T0 };
    w.localStorage.setItem('ac_sec_smart_sync_v1_patrol', JSON.stringify({ hashes:{ 'h:05':'oldhash5', 'h:06':'oldhash6' } }));
    assert(await w.SEC.cloudPush('patrol', copy(scans)));
    const man = srv.manifests.patrol.buckets;
    assert(!man['h:05'], 'old hash bucket whose rows all live in month buckets is dropped');
    assert(man['h:06'], 'old bucket with rows this device does not have is kept');
    const all = srv.all('patrol');
    assert.equal(all.length, 31, 'no punch lost during bucket migration');
    srv.reset(); assert(await w.SEC.cloudPush('patrol', copy(scans)));
    assert.equal(srv.count('GET', 'smartBucket'), 0, 'kept old bucket is verified once, not on every upload');
    pass('patrol punches bucket by month via t; superseded hash buckets dropped only after verifying every row exists locally; nothing lost');
  }

  /* 3f. Deletion ledger: batch, no 5000 cap, 400-day age cap, batch clear */
  {
    const { w } = await makeWin(); const S = w.SEC;
    let writes = 0; const orig = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (k, v) { if (/^ac_sec_deleted_v1_/.test(k)) writes++; return orig.call(this, k, v); };
    const rows = Array.from({ length:12000 }, (_, i) => ({ id:'D' + i, date:'2026-09-01', photo:'data:image/jpeg;base64,AAAA' }));
    const t0 = Date.now(); S.markDeletedMany('patrol', rows); const dt = Date.now() - t0;
    await S.dataReady(); await sleep(20);
    assert.equal(S.getDeleted('patrol').length, 12000, 'no silent 5000 cap');
    assert(dt < 1500, 'batch delete is fast (' + dt + 'ms)');
    assert.equal(writes, 1, 'one storage write for the whole batch');
    assert(!S.getDeleted('patrol')[0].photo, 'tombstones never copy photos');
    const old = { _deleted:true, _recordKey:'patrol|id|OLD', updatedAt:new w.Date(Date.now() - 401 * 86400000).toISOString() };
    S.mergeRecords('patrol', [], [old]);
    assert(!S.getDeleted('patrol').some(r => r._recordKey === 'patrol|id|OLD'), 'tombstones older than 400 days are dropped');
    writes = 0; const n = S.clearDeletedMany('patrol', rows.slice(0, 5000)); await sleep(20);
    assert.equal(n, 5000); assert.equal(S.getDeleted('patrol').length, 7000); assert.equal(writes, 1);
    S.markDeleted('patrol', { id:'X1' }); S.clearDeleted('patrol', { id:'X1' });
    assert(!S.getDeleted('patrol').some(r => r._recordKey === 'patrol|id|X1'));
    const merged = S.mergeRecords('patrol', [{ id:'D6000', date:'2026-09-01' }], []);
    assert.equal(merged.records.length, 0, 'deleted record is not resurrected by merge');
    w.Storage.prototype.setItem = orig;
    pass('markDeletedMany/clearDeletedMany batch (one write for 12,000 rows), no 5000 cap, 400-day age cap, tombstones without photos');
  }

  /* 3i. Asset changes: no duplicate photo copies; atomic photo deletion still works */
  {
    const { w } = await makeWin(); const S = w.SEC, A = S.AssetChanges;
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(5000);
    const before = [{ id:'F1', code:'FE01', type:'ext', factory:'a', zone:'z', loc:'Gate', status:'ok', photos:['old-photo'] }];
    const after = [Object.assign(copy(before[0]), { photos:['old-photo', big], remark:'moved' })];
    const ev = []; A.capture('fire', ev, before, after, { date:'2026-09-14' });
    assert.equal(ev.length, 1); assert.equal(ev[0].kind, 'update');
    assert(!JSON.stringify(ev[0].before).includes('old-photo') && !JSON.stringify(ev[0].after).includes(big), 'before/after hold no photo copies');
    assert.equal(ev[0].after.photoN, 2); assert.deepEqual(copy(ev[0].photos), [big], 'update event keeps only the newly added photo');
    assert(!JSON.stringify(after[0]._assetState).includes(big), '_assetState holds no photo copy');
    const legacy = [{ id:'e', before:{ photos:['x', 'y'] }, after:{ photos:['z'] } }]; A.slimEvents(legacy);
    assert.equal(legacy[0].before.photoN, 2); assert.equal(legacy[0].before.photos, undefined);
    // atomic photo deletion through client merge
    const withPhoto = Object.assign(copy(after[0]), { updatedAt:'2026-09-14T01:00:00Z' });
    const cleared = Object.assign(copy(after[0]), { photos:[] }); const ev2 = [];
    A.capture('fire', ev2, [withPhoto], [cleared], { date:'2026-09-15' }); cleared.updatedAt = '2026-09-15T01:00:00Z';
    assert.equal(S.mergeRecords('fire', [withPhoto], [cleared]).records[0].photos.length, 0, 'deleted photos stay deleted');
    assert.equal(S.mergeRecords('fire', [cleared], [withPhoto]).records[0].photos.length, 0, 'deleted photos stay deleted (reverse order)');
    const later = new Date(Date.now() + 60000).toISOString(), newer = Object.assign(copy(withPhoto), { photos:['p2'], updatedAt:later });
    newer._assetState = S.replaceObject(A.fields('fire', newer), later);
    assert.deepEqual(copy(S.mergeRecords('fire', [cleared], [newer]).records[0].photos), ['p2']);
    S.setLang('en'); const pages = A.pages('fire', ev, { ptype:'month', period:'2026-09', lang:'en' });
    assert(!CJK.test(pages.map(p => p.text).join('\n')), 'fire change summary in English has no Chinese');
    S.setLang('km'); assert(!CJK.test(A.pages('cctv', [], { ptype:'month', period:'2026-09', lang:'km' })[0].text));
    pass('asset changes keep photos on the main record only (before/after/_assetState use photo count+hash); atomic photo deletion preserved; single-language change summaries');
  }

  /* 3g. IndexedDB unavailable/failing → memory + persistent trilingual warning (jsdom has no IndexedDB, localStorage full) */
  {
    const { w } = await makeWin(); const S = w.SEC; S.setLang('zh');
    w.Storage.prototype.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
    const ok = await S.dbPut('ac_sec_test_big', [{ id:1 }]);
    assert.equal(ok, false); assert.deepEqual(copy(await S.dbGet('ac_sec_test_big', [])), [{ id:1 }], 'latest data kept in memory and read back');
    const t = [...w.document.querySelectorAll('.toast')].map(x => x.textContent).join('|');
    assert(/未儲存到手機，請立即上傳雲端/.test(t) && /sticky/.test(w.document.querySelector('.toast.err').className), 'persistent warning shown');
    pass('storage write failure keeps data in memory (read back by dbGet) and shows a persistent "not saved on this phone" warning');
  }

  /* 4 + 6 + 3c/3d. Cloud status, manual button guard, resume throttle, header */
  {
    const srv = fakeServer(); const { w } = await makeWin(); const S = w.SEC, d = w.document; w.fetch = srv.fetch;
    d.getElementById('hdr').innerHTML = S.headerHtml('🧪', { zh:'測試模組', en:'Test module', km:'ម៉ូឌុលសាកល្បង' }, 'AC SECURITY · TEST');
    let pushes = 0, pulls = 0, recs = [rec('1', '2026-09-01', 1)];
    S.bindHeader('expense', { onUpload(){ throw new Error('must route through runAutoCloudSync'); }, onDownload(){ throw new Error('must route through runAutoCloudSync'); }, onTelegram(){}, onSmartImport(){} });
    S.registerAutoUploader('expense', async () => { pushes++; return S.cloudPush('expense', copy(recs)); });
    S.registerAutoDownloader('expense', async () => { pulls++; const r = await S.cloudPull('expense', { localRecords:recs }); return !!r; });
    await sleep(20);
    // offline: red, never green
    srv.down = true;
    await S.runAutoCloudSync('expense', { reason:'startup-reconcile' });
    const st = d.querySelector('.c-state');
    assert(/retry|offline/.test(st.className) && /離線／未上雲/.test(st.textContent), 'failed round trip is red "離線／未上雲": ' + st.className + ' ' + st.textContent);
    assert(/err/.test(d.querySelector('.c-dot').className)); assert(!/ok/.test(d.querySelector('.c-dot').className));
    S.setLang('en'); assert(/Offline/.test(d.querySelector('.c-state').textContent) && !CJK.test(d.querySelector('.c-state').textContent));
    S.setLang('km'); assert(!CJK.test(d.querySelector('.c-state').textContent)); S.setLang('zh');
    srv.down = false;
    // manual ⬆️ twice while slow → one run; button disabled during the run
    srv.delay = 40; pushes = 0; pulls = 0;
    d.getElementById('btnUp').click(); await sleep(5);
    assert.equal(d.getElementById('btnUp').disabled, true, 'button disabled while syncing');
    d.getElementById('btnUp').click(); d.getElementById('btnDown').click();
    for (let i = 0; i < 100 && S.autoSyncDebug().busy.expense; i++) await sleep(20);
    assert.equal(pushes, 1, 'no concurrent manual runs'); assert.equal(pulls, 1);
    assert.equal(d.getElementById('btnUp').disabled, false);
    assert(/synced/.test(d.querySelector('.c-state').className) && /ok/.test(d.querySelector('.c-dot').className), 'green only after a successful round trip');
    srv.delay = 0;
    // resume throttle: visibilitychange within 5 minutes does nothing
    pushes = 0; d.dispatchEvent(new w.Event('visibilitychange')); w.dispatchEvent(new w.Event('pageshow')); await sleep(300);
    assert.equal(pushes, 0, 'resume within 5 minutes does not sync again');
    const realNow = w.Date.now; w.Date.now = () => realNow() + 6 * 60 * 1000;
    d.dispatchEvent(new w.Event('visibilitychange')); await sleep(400); w.Date.now = realNow;
    for (let i = 0; i < 50 && S.autoSyncDebug().busy.expense; i++) await sleep(20);
    assert.equal(pushes, 1, 'resume after 5 minutes syncs once');
    // header: admin buttons inside ⋯ menu; Telegram/home/lang visible; texts single language
    const menu = d.getElementById('secMoreMenu');
    ['btnUp', 'btnDown', 'btnSmart', 'btnCfg'].forEach(id => assert(menu.contains(d.getElementById(id)), id + ' in ⋯ menu'));
    ['btnTg', 'btnHome', 'btnMore'].forEach(id => assert(!menu.contains(d.getElementById(id))));
    for (const lang of ['en', 'km']) {
      S.setLang(lang);
      assert(!CJK.test(allText(d.querySelector('.hdr')).replace(/繁中/g, '')), lang + ' header has no Chinese');
    }
    S.setLang('zh'); assert(/測試模組/.test(d.querySelector('.hdr-t1').textContent));
    // toast: errors persist until tapped, action button works
    let retried = 0; const tt = S.toast('boom', 'err', 1000, { label:'retry', fn:() => retried++ });
    await sleep(1200); assert(tt.isConnected, 'error toast stays'); tt.querySelector('.toast-act').click(); assert.equal(retried, 1); await sleep(300); assert(!tt.isConnected);
    pass('cloud status red "offline / not in cloud" on failure (trilingual), green only after round trip; manual ⬆️/⬇️ share the busy guard and disable; resume sync throttled to 5 min; admin buttons in ⋯ menu; sticky error toasts');
  }

  /* 5 + 7. Shared modals in en/km contain no Chinese; Telegram preview excludes deleted items; Send disabled while sending */
  {
    const srv = fakeServer(); const { w } = await makeWin(); const S = w.SEC, d = w.document; w.fetch = srv.fetch;
    for (const lang of ['en', 'km']) {
      S.setLang(lang);
      S.openSettings(); d.getElementById('cfgAdvBtn').click();
      const sm = d.getElementById('secCfgMask'); assert(!CJK.test(allText(sm) + [...sm.querySelectorAll('option')].map(o => o.textContent).join('')), lang + ' settings');
      S.closeSettings();
      S.pickPhoto(() => {}); const pm = [...d.querySelectorAll('.mask.on')].pop(); assert(!CJK.test(allText(pm)), lang + ' photo picker'); pm.remove();
      const items = [{ id:'a', name:'Guard fee', dept:'Security Fee', amount:100 }, { id:'b', name:'Deleted', dept:'Security Fee', amount:900, _deleted:true }];
      const h = S.tgOpen({ module:'expense', canApprove:true, summaryPages:() => ['Summary line'], approvalItems:() => items });
      const tg = [...d.querySelectorAll('.mask.on')].pop();
      assert(!CJK.test(allText(tg) + [...tg.querySelectorAll('option')].map(o => o.textContent).join('')), lang + ' Telegram modal: ' + allText(tg).split('\n').filter(x => CJK.test(x)).join(' | '));
      assert.equal(tg.querySelector('#tgLang').value, lang, 'message language follows UI language');
      tg.querySelector('[data-tg-mode="approval"]').click();
      const pv = tg.querySelector('#tgPreview').textContent;
      assert(/\$100\.00/.test(pv) && !/Deleted|900/.test(pv), 'approval preview excludes _deleted items and totals match');
      assert(!CJK.test(pv), lang + ' approval preview');
      h.close();
    }
    S.setLang('en');
    srv.delay = 60; srv.telegram.length = 0;
    const h = S.tgOpen({ module:'patrol', summaryPages:() => ['Patrol summary'] });
    const send = d.getElementById('tgSend'); send.click(); await sleep(5); assert.equal(send.disabled, true); send.click(); send.click();
    await sleep(250); assert.equal(srv.telegram.length, 1, 'double tap sends once');
    srv.delay = 0; h.close();
    const errs = [];
    ['❌', 'x'].forEach(() => {});
    S.setLang('km'); try { await S.gasPost({ action:'ping' }); } catch (e) { errs.push(e); }
    w.fetch = async () => { throw new TypeError('Failed to fetch'); };
    try { await S.gasPost({ action:'ping' }); } catch (e) { errs.push(e); }
    assert.equal(errs.length, 1); assert.equal(errs[0].code, 'NETWORK'); assert(!CJK.test(errs[0].message) && /ទូរស័ព្ទ/.test(errs[0].message), 'plain-language Khmer network error');
    const src = ['shared/sec-core.js', 'shared/sec-smart-sync.js', 'shared/sec-asset-changes.js', 'shared/sec-personnel.js'].map(read).join('\n');
    assert(!/[㐀-鿿][^'"\n]*\s\/\s[A-Za-z][^'"\n]*['"]/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no "中文 / English" bilingual literals left in shared files');
    assert.equal(S.I18N.km.cloudFail, 'ធ្វើសមកាលកម្មពពកបរាជ័យ');
    pass('settings, photo picker, Telegram modal and approval preview contain no Chinese in en/km; preview excludes _deleted items; Send cannot double-send; errors are plain single-language text');
  }

  /* Real Chromium 390x844: all 9 pages in zh/en/km, no console errors; index + shared modals scanned for Chinese */
  await chromiumChecks();
  console.log('ALL PASS (' + passed + ' groups)');
})().catch(e => { console.error(e); process.exitCode = 1; });

async function chromiumChecks() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('playwright-core')); } catch (_) { console.log('SKIP: Chromium checks (playwright not installed)'); return; } }
  const exe = process.env.SEC_TEST_CHROMIUM || '/opt/pw-browsers/chromium';
  const browser = await chromium.launch({ executablePath:fs.existsSync(exe) && fs.statSync(exe).isFile() ? exe : undefined, args:['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], headless:true });
  const srv = fakeServer();
  const pages = ['index.html', 'ac_sec_attendance_v2.html', 'ac_sec_cctv_v2.html', 'ac_sec_commute_v2.html', 'ac_sec_container_v2.html', 'ac_sec_expense_v1.html', 'ac_sec_fire_v1.html', 'ac_sec_patrol_v2.html', 'ac_sec_personnel_v1.html'];
  const problems = [];
  try {
    for (const lang of ['zh', 'en', 'km']) {
      const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
      await ctx.addInitScript(l => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('ac_sec_config', JSON.stringify({ lang:l, operator:'Tester' })); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, lang);
      await ctx.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url());
        if (u.hostname === 'offline.test') {
          const p = path.join(root, decodeURIComponent(u.pathname));
          if (fs.existsSync(p) && fs.statSync(p).isFile()) return route.fulfill({ status:200, contentType:p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'application/javascript' : p.endsWith('.css') ? 'text/css' : p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream', body:fs.readFileSync(p) });
          return route.fulfill({ status:404, body:'' });
        }
        if (u.hostname === 'script.google.com') {
          const r = await srv.fetch(req.url(), { method:req.method(), body:req.postData() });
          return route.fulfill({ status:200, contentType:'application/json', headers:{ 'access-control-allow-origin':'*' }, body:await r.text() });
        }
        if (/chart\.js|chart\.umd/i.test(u.pathname)) return route.fulfill({ status:200, contentType:'application/javascript', body:'window.Chart=class{constructor(){this.data={};this.options={}}destroy(){}update(){}};window.Chart.register=function(){};' });
        if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.fulfill({ status:200, contentType:'text/css', body:'' });
        return route.fulfill({ status:200, contentType:'application/javascript', body:'' });
      });
      for (const name of pages) {
        const page = await ctx.newPage(), errors = [];
        page.on('pageerror', e => errors.push('pageerror: ' + e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        await page.goto('https://offline.test/' + name);
        await page.waitForTimeout(1500);
        const info = await page.evaluate(() => {
          const r = { lang:SEC.lang(), boot:!!document.getElementById('secBootError'), overflow:document.documentElement.scrollWidth > innerWidth + 1 };
          const hdr = document.querySelector('.hdr');
          if (hdr) {
            r.small = ['btnTg', 'btnHome', 'btnMore'].map(id => document.getElementById(id)).filter(e => e && e.offsetParent).map(e => e.getBoundingClientRect()).filter(b => b.height < 44 || b.width < 44).length;
            r.smallLang = [...document.querySelectorAll('.lang-sw .lb')].filter(b => b.getBoundingClientRect().height < 44).length;
            const clone = hdr.cloneNode(true); clone.querySelectorAll('.lang-sw,.hdr-t1,.hdr-t2').forEach(n => n.remove());
            r.hdrText = clone.innerText + ' ' + [...clone.querySelectorAll('[title],[aria-label]')].map(n => (n.title || '') + ' ' + (n.getAttribute('aria-label') || '')).join(' ');
            r.state = (document.querySelector('.c-state') || {}).className;
            r.stateText = (document.querySelector('.c-state') || {}).textContent;
          }
          return r;
        });
        if (errors.length) problems.push(lang + ' ' + name + ': ' + errors.join(' || '));
        if (info.lang !== lang) problems.push(lang + ' ' + name + ': language not applied (' + info.lang + ')');
        if (info.boot) problems.push(lang + ' ' + name + ': boot error banner');
        if (info.overflow) problems.push(lang + ' ' + name + ': horizontal overflow');
        if (info.small) problems.push(lang + ' ' + name + ': header buttons < 44px');
        if (info.smallLang) problems.push(lang + ' ' + name + ': language switch < 44px');
        if (lang !== 'zh' && info.hdrText && /[㐀-鿿]/.test(info.hdrText)) problems.push(lang + ' ' + name + ': Chinese in shared header: ' + info.hdrText.match(/[^\n]*[㐀-鿿][^\n]*/)[0]);
        if (name === 'index.html' && lang !== 'zh') {
          const t = await page.evaluate(() => { SEC.openSettings(); document.getElementById('cfgAdvBtn').click(); const m = document.getElementById('secCfgMask'); return document.body.innerText + [...document.querySelectorAll('option,[placeholder],[title]')].map(e => e.textContent + (e.placeholder || '') + (e.title || '')).join(' '); });
          const leak = t.split('\n').filter(x => /[㐀-鿿]/.test(x.replace(/繁中/g, '')));
          if (leak.length) problems.push(lang + ' index.html Chinese: ' + leak.join(' | '));
        }
        if (name === 'ac_sec_expense_v1.html' && lang !== 'zh') {
          const t = await page.evaluate(async () => {
            const out = [];
            document.getElementById('btnMore').click(); out.push(document.getElementById('secMoreMenu').innerText);
            document.getElementById('btnCfg').click(); document.getElementById('cfgAdvBtn').click();
            const m = document.getElementById('secCfgMask'); out.push(m.innerText, [...m.querySelectorAll('option,[placeholder]')].map(e => e.textContent + (e.placeholder || '')).join(' ')); SEC.closeSettings();
            SEC.pickPhoto(function () {}); let pm = [...document.querySelectorAll('.mask.on')].pop(); out.push(pm.innerText); pm.remove();
            SEC.tgOpen({ module:'patrol', summaryPages:() => ['Summary'] }); pm = [...document.querySelectorAll('.mask.on')].pop();
            out.push(pm.innerText, [...pm.querySelectorAll('option')].map(o => o.textContent).join(' '));
            SEC.toast('test', 'err');
            const toast = document.querySelector('.toast.err').getBoundingClientRect(), sendBtn = document.getElementById('tgSend').getBoundingClientRect();
            const overlap = !(toast.bottom <= sendBtn.top || toast.top >= sendBtn.bottom || toast.right <= sendBtn.left || toast.left >= sendBtn.right);
            return { text:out.join('\n'), toastTop:toast.top, overlap };
          });
          const leak = t.text.split('\n').filter(x => /[㐀-鿿]/.test(x));
          if (leak.length) problems.push(lang + ' shared modals Chinese: ' + leak.join(' | '));
          if (t.toastTop > 120) problems.push('toast not at top: ' + t.toastTop);
          if (t.overlap) problems.push('toast overlaps Telegram Send button');
        }
        if (name === 'ac_sec_expense_v1.html' && lang === 'zh') {
          const t = await page.evaluate(async () => {
            /* IndexedDB: deletion ledger migrated from localStorage (6000 rows, no cap), persisted, and write-failure warning */
            const rows = Array.from({ length:6000 }, (_, i) => ({ _deleted:true, _recordKey:'zz|id|' + i, updatedAt:new Date().toISOString() }));
            localStorage.setItem('ac_sec_deleted_v1_zz', JSON.stringify(rows));
            return rows.length;
          });
          await page.reload(); await page.waitForTimeout(1200);
          const r = await page.evaluate(async () => {
            await SEC.dataReady();
            const n = SEC.getDeleted('zz').length, ls = localStorage.getItem('ac_sec_deleted_v1_zz');
            const idb = await SEC.dbGet('ac_sec_deleted_v1_zz', null);
            const origPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
            const ok = await SEC.dbPut('ac_sec_expense_db', [{ id:'mem' }]);
            IDBObjectStore.prototype.put = origPut;
            const back = await SEC.dbGet('ac_sec_expense_db', []);
            const toast = [...document.querySelectorAll('.toast.err')].map(x => x.textContent).join('|');
            return { n, ls, idb:Array.isArray(idb) ? idb.length : -1, ok, back:back.map(x => x.id).join(','), toast };
          });
          if (r.n !== 6000 || r.ls !== null || r.idb !== 6000) problems.push('IndexedDB ledger migration: ' + JSON.stringify(r).slice(0, 200));
          if (r.ok !== false || r.back !== 'mem' || !/未儲存到手機/.test(r.toast)) problems.push('IndexedDB write failure handling: ' + JSON.stringify(r).slice(0, 300));
        }
        await page.close();
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
  if (problems.length) { console.error(problems.join('\n')); throw new Error(problems.length + ' Chromium problem(s)'); }
  pass('Chromium 390x844: all 9 pages load in zh/en/km with no console/page errors, no overflow, ≥44px header/language buttons, no Chinese in shared header/index/settings/photo picker/Telegram modal in en/km, toasts at top not covering Send; IndexedDB ledger migration (6000 rows) and write-failure warning');
}
