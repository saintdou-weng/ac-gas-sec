/* End-to-end: real expense page (jsdom) ⇄ real ac_sec.gs doPost ⇄ Telegram buttons.
   Checks the approval contract across front end and backend:
   send → group message with buttons → forged / non-approver presses ignored → Paul approves
   → page status shows approved → edit amount → only that record goes back for re-approval.
   Run: node tests/integration-approval.cjs */
const assert = require('assert/strict');
const { load } = require('./dom-harness.cjs');
const { runtime } = require('./backend.cjs');
const PAUL = '5026942575', GUARD = '999', KEY = 'k' + 'a1b2c3d4e5f6';

(async () => {
  const r = runtime('2026-09-14T03:00:00Z'), c = r.c;
  c.isApprover = uid => String(uid) === PAUL;             /* same rule as APPROVERS */
  r.props.WEBHOOK_KEY = KEY;
  const answers = [];
  c.answerCb = (id, text) => answers.push(String(text || ''));
  const post = (body, k) => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) }, parameter: k ? { k } : {} }).text);

  const { w, errors } = await load('ac_sec_expense_v1.html');
  assert.deepEqual(errors, [], 'page loads without script errors');
  /* route the page's real network calls into the real GAS doPost */
  w.fetch = async (url, opt) => {
    const text = c.doPost({ postData: { contents: String(opt && opt.body || '{}') }, parameter: {} }).text;
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  w.SEC.scheduleAutoCloudSync = () => {};
  const run = code => w.eval(code);
  run(`PER = new SEC.Period('month'); PER.at = new Date(2026, 8, 15);
       DB = [
        {id:'r-A', code:'SVC-202609-001', name:'Security service fee', cat:'Security Fee', vendor:'GS Co', qty:1, unit:'month', amount:1200, date:'2026-09-01'},
        {id:'r-B', code:'SVC-202609-002', name:'Security service fee', cat:'Security Fee', vendor:'GS Co', qty:1, unit:'month', amount:300,  date:'2026-09-02'},
        {id:'r-C', code:'EXP-20260902-001', name:'Radio battery', cat:'Equipment', qty:2, unit:'pc', amount:40, date:'2026-09-02'} ];
       document.getElementById('aScope').value = 'all'; renderAll();`);
  const inScope = run(`targets().map(x=>x.id).join(',')`);
  assert.equal(inScope, 'r-A,r-B', 'only Security Fee records are sent for approval');

  await run('doSend()');
  const bid = run(`DB.filter(x=>x.id==='r-A')[0].batchId`);
  assert(bid, 'batchId stored on records');
  const msg = r.messages.find(m => m.keyboard && JSON.stringify(m.keyboard).includes(bid));
  assert(msg, 'group approval message with buttons was sent');
  const cq = (from, data) => ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'q' + Math.random(), from: { id: Number(from) }, data, message: { message_id: 1, chat: { id: -5009220114 } } } });
  const edits = []; c.tgEdit = (chat, mid, text, kb) => { edits.push({ text, kb }); return true; };
  const btns = kb => (kb && kb.inline_keyboard || []).flat();
  btns(msg.keyboard).forEach(b => b.callback_data && assert(Buffer.byteLength(b.callback_data) <= 64, 'callback_data ≤ 64 bytes'));
  const reviewBtn = btns(msg.keyboard).find(b => /^bv:/.test(b.callback_data || ''));
  assert(reviewBtn, 'review button present');
  /* forged review (no key) ignored; a guard (anyone) may review with a genuine press */
  post(cq(GUARD, reviewBtn.callback_data));
  assert.equal(edits.length, 0, 'forged review ignored');
  post(cq(GUARD, reviewBtn.callback_data), KEY);
  const afterReview = edits.map(e => e.kb).filter(Boolean).pop();
  const buttons = btns(afterReview);
  buttons.forEach(b => b.callback_data && assert(Buffer.byteLength(b.callback_data) <= 64, 'callback_data ≤ 64 bytes'));
  const approveAll = buttons.find(b => /^ba:/.test(b.callback_data || ''));
  assert(approveAll, 'approve-all button present after review: ' + buttons.map(b => b.callback_data).join(' '));

  /* forged update (no webhook key) → ignored */
  post(cq(PAUL, approveAll.callback_data));
  let st = post({ action: 'approvalStatus', batchId: bid }).data || post({ action: 'approvalStatus', batchId: bid });
  assert(st.items.every(x => x.status !== 'approved'), 'forged update without key must not approve');
  /* genuine Telegram press by a guard → refused */
  post(cq(GUARD, approveAll.callback_data), KEY);
  st = post({ action: 'approvalStatus', batchId: bid }).data;
  assert(st.items.every(x => x.status !== 'approved'), 'non-approver cannot approve');
  /* genuine press by Paul → approved */
  post(cq(PAUL, approveAll.callback_data), KEY);
  st = post({ action: 'approvalStatus', batchId: bid }).data;
  assert(st.items.length === 2 && st.items.every(x => x.status === 'approved'), 'Paul approves: ' + JSON.stringify(st.items));

  await run('checkStatus()');
  assert.equal(run(`DB.filter(x=>x.id==='r-A')[0].apprStatus`), 'approved');
  assert.equal(run(`DB.filter(x=>x.id==='r-B')[0].apprStatus`), 'approved');
  assert(!run(`DB.filter(x=>x.id==='r-C')[0].apprStatus`), 'non-fee record untouched');

  /* edit an approved record's amount → only that one needs re-approval */
  run(`(function(){var x=DB.filter(y=>y.id==='r-B')[0]; x.amount=999; x.apprStatus=''; x.batchId=''; renderAll();})()`);
  assert.equal(run(`targets().map(x=>x.id).join(',')`), 'r-B', 'only the changed record is pending again');
  const before = r.messages.length;
  await run('doSend()');
  const bid2 = run(`DB.filter(x=>x.id==='r-B')[0].batchId`);
  assert(bid2 && bid2 !== bid, 'changed approved item goes into a NEW batch');
  assert(r.messages.length > before, 'new approval message sent');
  st = post({ action: 'approvalStatus', batchId: bid2 }).data;
  assert.equal(st.items.length, 1); assert.equal(st.items[0].key, 'r-B'); assert.equal(st.items[0].status, 'pending');

  /* double-click send → one batch only */
  run(`(function(){var x=DB.filter(y=>y.id==='r-A')[0]; x.amount=1250; x.apprStatus=''; x.batchId=''; renderAll();})()`);
  const n0 = r.messages.length;
  await Promise.all([run('doSend()'), run('doSend()')]);
  assert.equal(r.messages.filter((m, i) => i >= n0 && m.keyboard).length, 1, 'double click sends once');

  console.log('PASS: expense page ⇄ GAS ⇄ Telegram buttons: fee-only scope, forged/guard presses ignored, Paul approves, page shows status, edited item re-approved in a new batch, double-click sends once');
})().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
