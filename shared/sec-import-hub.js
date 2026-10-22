/* AC Security 智慧匯入中心（2026-10-22）
 * 首頁和每一頁最上面同一顆「⇧ 智慧匯入」：msg／eml／Excel／CSV／zip／照片丟同一個地方，
 * 系統依檔名、分頁名、表頭判斷是哪個模組（判不出來才問一次），再用「該模組頁自己的匯入函式」匯入
 * （其他模組在背景開該頁跑；本頁的模組直接在本頁跑），所以合併、去重、月份、人員規則與在模組頁匯入完全一樣。
 * 同一個檔（內容 SHA-256 相同）再丟＝0 新增，不會重匯；重複的紀錄由各模組原本的去重規則擋掉。
 * 匯完等該模組上雲完成，再問要不要「✈️ 發摘要」／「✅ 核可」（開模組頁的 Telegram 視窗，先預覽再按發送）。
 */
(function (g) {
  'use strict';
  var SEC = g.SEC;
  if (!SEC || SEC.ImportHub) return;
  var L = SEC.L, esc = SEC.esc;
  var LOG_KEY = 'ac_sec_import_log_v1', HANDOFF_KEY = 'ac_sec_hub_handoff_v1', LIB_SRC = 'shared/sec-files.min.js?v=20261022a', XLSX_SRC = 'shared/xlsx.full.min.js';
  var TOOLS = {
    patrol:     { ic:'🚨', page:'ac_sec_patrol_v2.html',     zh:'保安巡邏', en:'Patrol',     km:'ល្បាត' },
    cctv:       { ic:'📷', page:'ac_sec_cctv_v2.html',       zh:'CCTV 監控', en:'CCTV',      km:'កាមេរ៉ា' },
    container:  { ic:'🚛', page:'ac_sec_container_v2.html',  zh:'貨櫃出入', en:'Container',  km:'កុងតឺន័រ' },
    expense:    { ic:'💰', page:'ac_sec_expense_v1.html',    zh:'保安費用', en:'Expense',    km:'ចំណាយ', approval:true },
    attendance: { ic:'🕐', page:'ac_sec_attendance_v2.html', zh:'保安出勤', en:'Attendance', km:'វត្តមាន' },
    commute:    { ic:'🏍', page:'ac_sec_commute_v2.html',    zh:'通勤交通', en:'Commute',    km:'ដំណើរ' },
    fire:       { ic:'🧯', page:'ac_sec_fire_v1.html',       zh:'消防設施', en:'Fire',       km:'ពន្លត់ភ្លើង' },
    personnel:  { ic:'👮', page:'ac_sec_personnel_v1.html',  zh:'保安人員', en:'Personnel',  km:'បុគ្គលិក' },
  };
  var ORDER = ['personnel', 'attendance', 'patrol', 'cctv', 'container', 'expense', 'commute', 'fire'];
  /* ── 判斷規則：每個（模組,種類）一組；name＝檔名、sheet＝分頁名、head＝前 15 列文字（小寫、去空白）。
        分數：name 3、sheet 2、head 2（每條規則各自計分，可多條）。各模組頁的匯入種類（kind）要與 SEC.registerImporter 登記的一致。 */
  /* ══ 判斷規則（每個模組一個區塊；改規則請只動自己模組的區塊）══
     每條 { tool, kind, name:/檔名/i, sheet:/分頁名/i, head:/前 15 列文字/, photo:true(照片用，只看檔名) }
     name 命中 +3、sheet +2、head +2（head 同時以「保留空白」與「去空白去符號」兩種形式比對，regex 請兩種都能命中）。
     自動採用的門檻：最高分 ≥3 且比第二名高 ≥1，否則列出讓人選。kind 必須與該頁 SEC.registerImporter 登記的一致。 */
  var RULES_BY_TOOL = {};

  /* ── personnel 保安人員名冊（importRosterFile：Security Roaster 月排班 findRosterScheduleHeader，或一般名冊 SEC.parseSheet(SPEC)）── */
  RULES_BY_TOOL.personnel = [
    /* Security Roaster：ID NO ＋ NAME ＋ SCHEDULE/SHIFT ＋ 每天一欄（1…31） */
    { tool:'personnel', kind:'roster', name:/roa?ster|name ?list|名冊|人員|guard ?list|security ?(staff|guard|personnel)|排班/i, sheet:/roa?ster|名冊|staff|guard|personnel|排班/i,
      head:/(?:\bid ?no\b|\bid ?number\b|\bid\b|idno|idnumber|工號|工号|編號|លេខ).{0,60}(?:\bname\b|姓名|ឈ្មោះ).{0,60}(?:schedule|\bshift\b|班別|班别|វេន)|(?:\bname\b|姓名|ឈ្មោះ).{0,60}(?:\bid ?no\b|idno|idnumber|工號|工号|編號).{0,60}(?:schedule|\bshift\b|班別|班别|វេន)/ },
    /* 一般名冊：姓名 ＋ 職稱／崗位／到職日／電話／公司／狀態（SPEC 欄位） */
    { tool:'personnel', kind:'roster', name:/roa?ster|name ?list|名冊|人員|guard ?list|security ?(staff|guard|personnel)|staff ?list|employee/i, sheet:/roa?ster|名冊|staff|guard|personnel|employee/i,
      head:/(?:\bname\b|fullname|姓名|員工姓名|ឈ្មោះ).{0,80}(?:position|職稱|职称|join ?date|到職日|到职日|hire ?date|start ?date|入職|\bpost\b|崗位|岗位|\bphone\b|電話|电话|\btel\b|mobile|company|公司|\bstatus\b|狀態|状态)|(?:position|職稱|职称|join ?date|到職日|到职日|\bpost\b|崗位|岗位).{0,80}(?:\bname\b|fullname|姓名|ឈ្មោះ)/ },
  ];

  /* ── attendance 保安出勤（impExcel：findAttendanceHeader 月曆表＝姓名／工號＋每天一欄；findLongAttendanceHeader 長格式＝工號／姓名＋日期＋狀態或上下班）── */
  RULES_BY_TOOL.attendance = [
    /* 月曆式：Name/姓名 之後接 1 2 3 4…（或日期序號 4xxxx 4xxxx 4xxxx），或表尾的 Dayoff／take Leave 圖例 */
    { tool:'attendance', kind:'excel', name:/attend|出勤|考勤|punch|打卡|shift ?[abc]\b|day ?shift|night ?shift/i, sheet:/attend|出勤|考勤|punch|打卡|shift|^\d{4}-\d{2}$/i,
      head:/(?:\bname\b|姓名|ឈ្មោះ).{0,80}\b1\b.{0,12}\b2\b.{0,12}\b3\b.{0,12}\b4\b|(?:\bname\b|姓名|ឈ្មោះ).{0,80}\b4\d{4}\b.{0,8}\b4\d{4}\b.{0,8}\b4\d{4}\b|dayoff|take ?leave/ },
    /* 長格式：工號／姓名 ＋ 日期 ＋ 狀態（或上班／下班時間） */
    { tool:'attendance', kind:'excel', name:/attend|出勤|考勤|punch|打卡/i, sheet:/attend|出勤|考勤|punch|打卡|\blog\b|record|紀錄|记录/i,
      head:/(?:\bid\b|idno|empid|employeeid|staffid|工號|工号|員工編號|編號|\bname\b|姓名|ឈ្មោះ).{0,60}(?:\bdate\b|workdate|attendancedate|日期|កាលបរិច្ឆេទ).{0,60}(?:\bstatus\b|狀態|状态|\bcode\b|代碼|代码|出勤|attendance|\bin\b|timein|checkin|clockin|上班|ចូល)/ },
  ];

  /* ── patrol 保安巡邏（巡邏機匯出／一般巡邏表）──
        wand＝巡更棒原始匯出（impWand 的 WAND_HDR）：巡检时间 Patrol Time／巡检器 ReaderNum／人员 Person／巡检点 Checkpoint／事件 Event／编号 Chip ID
        generic＝人工巡邏表（impGeneric 的 SPEC）：日期 Date／時間 Time／班別 Shift／巡邏員 Guard／地點 Location／狀態 Status／備註 Note */
  RULES_BY_TOOL.patrol = [
    { tool:'patrol', kind:'wand', name:/巡检|巡檢|巡更|巡邏機|wand|reader|guard ?tour|patrol ?(record|data|export|time|reader|machine)|patrol/i, sheet:/巡检|巡檢|巡邏|patrol|record|event|reader/i, head:/巡检时间|巡檢時間|patrol ?(date\/?)?time|reader ?num|巡检器|巡檢器|巡检点|巡檢點|chip ?id|checkpoint|patrolman|guard ?tour/ },
    /* 一般巡邏表：有「日期＋時間＋巡邏員／地點」或「班別＋巡邏員」標題；巡更棒檔（Chip ID／ReaderNum／巡检）一律不算，避免資料列裡的 Day Shift／Guard 誤判 */
    { tool:'patrol', kind:'generic', name:/patrol|巡邏|人工巡邏/i, sheet:/巡邏|patrol|manual/i, head:/^(?![\s\S]*(?:chip ?id|reader ?num|巡检|巡檢器|巡檢點))[\s\S]*?(?:(?:date|日期).{0,80}(?:time|時間|时间).{0,80}(?:guard|巡邏員|姓名|name|location|地點|巡邏點|checkpoint)|(?:date|日期).{0,80}(?:shift|班別|班别).{0,60}(?:guard|巡邏員))/ },
  ];

  /* ── cctv（impExcel 的 SPEC：編號 Code／名稱 Name／廠區 Factory／區域 Zone／類型 Type／NVR／通道 Channel／IP／狀態 Status／備註 Remark；資料列為 CCTV A-01 類正式編號）── */
  RULES_BY_TOOL.cctv = [
    { tool:'cctv', kind:'excel', name:/cctv|camera|cam ?list|攝影機|攝影|監視|監控|鏡頭/i, sheet:/cctv|camera|cam\b|攝影|監視|監控|鏡頭/i, head:/cctv ?[ab] ?-? ?\d{1,3}|\bcctv\b|camera|攝影機|監視器|鏡頭|\bnvr\b|\bdvr\b|ip ?address|lightbox/ },
  ];

  /* ── container 貨櫃出入 ── */
  /* tkImp 只認「貨櫃車登記表」：標題列（前 8 列）同時含 date／日期／កាល 與 container／貨櫃／កុងតឺ／truck，
     固定欄序 No／Date／Name／Licence／Container No／Truck No／Company／Import／Export／Visitor ID／Time In／Sign／Time Out／Sign／Remark（中英柬三層標題）。 */
  RULES_BY_TOOL.container = [
    { tool:'container', kind:'excel', name:/container|貨櫃|货柜|កុងតឺន័រ|truck ?(register|log|record|list|in ?out)|進出口|进出口/i, sheet:/container|貨櫃|货柜|កុងតឺន័រ|truck/i,
      head:/container ?(no|number|#)|貨櫃(號|編號|車)|货柜(号|车)|លេខកុងតឺន័រ|(import|進口|进口).{0,40}(export|出口).{0,120}(visitor|time ?in|入廠|入厂|進廠|进厂)|(container|貨櫃|货柜).{0,80}(truck|company|公司|車牌|车牌|licen[cs]e)/ },
  ];

  /* ── expense 保安費用 ──
        fee＝保安服務費申請表（impFee：上方 company／MONTH／DAY，下方 day shift／Night shift 各段 name／location／per month／total wk day／total wk hr／total hour／one hour／total pay）
        excel＝一般費用表（impExcel 的 SPEC：日期 Date／項目 Item／分類 Category／廠商 Vendor／數量 Qty／單位 Unit／單價 Price／金額 Amount／原因 Reason） */
  RULES_BY_TOOL.expense = [
    { tool:'expense', kind:'fee', name:/security ?(service ?)?fee|guard ?fee|fee ?application|保安(服務)?費|保全費|icsc/i, sheet:/fee|費|application|icsc|day ?shift|night ?shift/i, head:/total ?pay|one ?hour|total ?wk ?(day|hr)|total ?hour|per ?month.{0,120}total|company.{0,60}month.{0,60}day|security ?(service ?)?fee ?application|保安(服務)?費申請/ },
    { tool:'expense', kind:'excel', name:/expense|費用|支出|purchase|採購|petty ?cash|零用金|報銷|reimburse/i, sheet:/expense|費用|支出|purchase|採購/i, head:/(item|項目|品名|description|particulars|內容).{0,160}(amount|金額|cost|費用|小計|total)|(amount|金額|cost).{0,160}(item|項目|品名|description)|(category|分類|類別).{0,120}(amount|金額|cost)|(vendor|supplier|廠商|供應商).{0,120}(amount|金額|cost)/ },
  ];

  /* ── commute 通勤交通（車輛派遣／摩托車／出入閘／遲到；照片走 OCR）── */
  /* 依各匯入器實際認得的表頭（ac_sec_commute_v2.html）：
     car  impCar：transportation_record 格式，每張表＝一位司機（第 1 列「Driver: xxx」），標題列有「Reason／KM」成對欄位（km／kms／里數／distance）。
     bike impBike：Motor_Bike 格式，標題列有 Building A／Building B（或 A／B）＋ Total／Date。
     gate impGate：車輛出入閘登記（中／英／緬），需 ≥6 欄：日期、序號、車牌號、司機名字、乘客、部門、乘客人數、出閘時間、入閘時間、用車原因…
     late impLate：Come_Late_Register，欄位 Date／Company ID／Name／DPT／Time In／Time Out／Security／Other。 */
  RULES_BY_TOOL.commute = [
    { tool:'commute', kind:'car', name:/transport(ation)?[ _-]?record|vehicle|dispatch|car ?(log|record|use)|派車|派车|派遣|車輛(派|使用)|车辆(派|使用)/i, sheet:/transport|vehicle|dispatch|派車|派车|車輛|车辆/i,
      head:/driver ?[:：]|(reason|purpose|事由|原因) ?(km|kms|里數|distance)\b|(long|short) ?distance.{0,60}(reason|km)/ },
    { tool:'commute', kind:'bike', name:/motor[ _-]?bike|motorcycle|moto\b|bike|摩托|機車|机车/i, sheet:/motor|bike|moto\b|摩托|機車|机车/i,
      head:/building ?a.{0,40}building ?b|motor ?bike|motorcycle|摩托車|摩托车|機車|机车|អគារa.{0,30}អគារb/ },
    { tool:'commute', kind:'gate', name:/gate ?(log|record|pass|register|in ?out)|vehicle ?(in|out)|出入[閘闸]|進出|进出|門崗|门岗|出入(登記|登记)/i, sheet:/gate|出入|進出|进出|門崗|门岗/i,
      head:/(车牌|車牌|plate|vehicle ?no|truck ?number).{0,80}(司机|司機|driver).{0,120}(乘客|passenger|部门|部門|dept)|(出闸|出閘|入闸|入閘).{0,40}(時间|時間|时间|time)|(time ?out|time ?in).{0,40}(保安|security|purpose|用车|用車)/ },
    { tool:'commute', kind:'late', name:/come[ _-]?late|late[ _-]?(register|list|record|form|arrival)|遲到|迟到/i, sheet:/late|遲到|迟到/i,
      head:/come ?late|late ?register|遲到|迟到|មកយឺត|(company ?id|employee ?id|emp ?id|vrt ?code|factory ?id|工號|工号).{0,60}(name|姓名).{0,120}(time ?in|check ?in|in ?time|入廠|入厂)/ },
    { tool:'commute', kind:'car', photo:true, name:/transport|vehicle|dispatch|car\b|派車|派车|派遣|車輛|车辆/i },
    { tool:'commute', kind:'bike', photo:true, name:/bike|motor|moto\b|摩托|機車|机车/i },
    { tool:'commute', kind:'gate', photo:true, name:/gate|出入|[閘闸]|門崗|门岗|進出|进出/i },
    { tool:'commute', kind:'late', photo:true, name:/late|遲到|迟到/i },
  ];

  /* ── fire 消防（設備清單五類分頁／歷史月檢表）── */
  RULES_BY_TOOL.fire = [
    { tool:'fire', kind:'equipment', name:/fire ?(equip|list|extinguisher|alarm|hose)|exit ?light|smok(e|ing) ?detector|消防(設備|器材|清單)/i, sheet:/extinguisher|fire ?alarm|exit ?light|fire ?hose|smok(e|ing) ?detector|滅火器|警報|緊急照明|水帶|煙霧/i, head:/\bfe\d{2,3}\b|\bfa\d{2,3}\b|\bel\d{2,3}\b|\bhr\d{2,3}\b|expir(e|y) ?date|過期日/ },
    { tool:'fire', kind:'history', name:/月檢|monthly ?check|inspection ?(record|history)|巡檢(歷史|紀錄)/i, sheet:/月檢|check/i, head:/date ?check|check ?date|checked ?by|檢查日|檢查人|result|結果/ },
  ];

  var RULES = [].concat.apply([], ORDER.map(function (t) { return RULES_BY_TOOL[t] || []; }));
  var KIND_LABEL = {
    roster:['名冊', 'Roster', 'បញ្ជីឈ្មោះ'], excel:['Excel', 'Excel', 'Excel'], wand:['巡邏機紀錄', 'Patrol reader log', 'កំណត់ត្រាម៉ាស៊ីនល្បាត'], generic:['一般巡邏表', 'Patrol sheet', 'តារាងល្បាត'],
    fee:['保安費', 'Security fee', 'ថ្លៃសន្តិសុខ'], car:['車輛派遣', 'Vehicle dispatch', 'រថយន្ត'], bike:['摩托車', 'Motorbike', 'ម៉ូតូ'], gate:['出入閘', 'Gate log', 'ច្រកចេញចូល'], late:['遲到登記', 'Come late', 'មកយឺត'],
    equipment:['設備清單', 'Equipment list', 'បញ្ជីឧបករណ៍'], history:['歷史月檢表', 'Past monthly checks', 'ការត្រួតពិនិត្យចាស់'],
  };
  function kindLabel(k) { var x = KIND_LABEL[k]; return x ? L(x[0], x[1], x[2]) : k; }
  function toolName(t) { var d = TOOLS[t]; return d ? d.ic + ' ' + L(d.zh, d.en, d.km) : t; }
  function destLabel(t, k) { return toolName(t) + (k && k !== 'excel' ? ' · ' + kindLabel(k) : ''); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(fn, ms, step) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 60000)) { try { if (await fn()) return true; } catch (_) {} await sleep(step || 300); } return false; }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function when(t) { var d = new Date(t); return SEC.p2(d.getMonth() + 1) + '-' + SEC.p2(d.getDate()) + ' ' + SEC.p2(d.getHours()) + ':' + SEC.p2(d.getMinutes()); }
  function extOf(name) { var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }
  function isExcel(ext) { return /^(xlsx|xlsm|xls|xlsb|csv)$/.test(ext); }
  function isPhoto(ext) { return /^(jpe?g|png|webp|heic|heif|gif|bmp)$/.test(ext); }
  function stripTags(h) { return String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); }
  function loadScript(src, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = function () { test() ? res() : rej(new Error(src)); }; s.onerror = function () { rej(new Error(L('元件載入失敗：', 'Could not load: ', 'មិនអាចផ្ទុក: ') + src)); }; document.head.appendChild(s); });
  }
  function libs() { return loadScript(LIB_SRC, function () { return g.JSZip && g.MsgReader; }); }
  function xlsx() { return loadScript(XLSX_SRC, function () { return typeof g.XLSX !== 'undefined'; }); }
  async function hashOf(buf) {
    try { var d = await crypto.subtle.digest('SHA-256', buf); return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); } catch (_) { return ''; }
  }
  async function logRead() { var v = await SEC.dbGet(LOG_KEY, {}); return v && typeof v === 'object' ? v : {}; }
  async function logWrite(v) {
    var keys = Object.keys(v); if (keys.length > 600) keys.sort(function (a, b) { return (v[a].at || 0) - (v[b].at || 0); }).slice(0, keys.length - 600).forEach(function (k) { delete v[k]; });
    await SEC.dbPut(LOG_KEY, v);
  }

  /* ── 把檔案展開：zip → 裡面的檔；msg／eml → 附件；其他照原樣 ── */
  async function expand(file, via, out, depth) {
    depth = depth || 0; var ext = extOf(file.name);
    if (depth > 3) { out.push({ file:file, via:via, unsupported:L('層數太深', 'Too deeply nested', 'ជ្រៅពេក') }); return; }
    if (ext === 'zip') {
      await libs();
      var z = await g.JSZip.loadAsync(await file.arrayBuffer()), names = Object.keys(z.files).filter(function (n) { return !z.files[n].dir && !/(^|\/)(__MACOSX|\.DS_Store|thumbs\.db)/i.test(n); });
      if (!names.length) { out.push({ file:file, via:via, unsupported:L('空的 zip', 'Empty zip', 'zip ទទេ') }); return; }
      for (var i = 0; i < names.length; i++) {
        var blob = await z.files[names[i]].async('blob'), base = names[i].split('/').pop();
        await expand(new File([blob], base, { type:blob.type || '' }), (via ? via + ' › ' : '') + file.name, out, depth + 1);
      }
      return;
    }
    if (ext === 'msg') {
      await libs();
      var r = new g.MsgReader(await file.arrayBuffer()), data = r.getFileData() || {}, atts = Array.isArray(data.attachments) ? data.attachments : [], subject = String(data.subject || '').trim();
      var usable = 0;
      for (var a = 0; a < atts.length; a++) {
        var att = r.getAttachment(a); if (!att || !att.content) continue;
        var an = att.fileName || atts[a].fileName || ('attachment' + (a + 1)); if (atts[a].attachMimeTag === 'message/rfc822' && !extOf(an)) an += '.eml';
        var aext = extOf(an); if (!(isExcel(aext) || isPhoto(aext) || /^(zip|msg|eml|pdf)$/.test(aext))) continue;
        usable++;
        await expand(new File([att.content], an, { type:'' }), (via ? via + ' › ' : '') + file.name + (subject ? '「' + subject + '」' : ''), out, depth + 1);
      }
      if (!usable) out.push({ file:file, via:via, unsupported:L('這封信沒有可匯入的附件', 'No importable attachment in this message', 'គ្មានឯកសារភ្ជាប់') + (subject ? '（' + subject + '）' : '') });
      return;
    }
    if (ext === 'eml') {
      var text = await file.text(), subj = (text.match(/^Subject:\s*(.*)$/mi) || [])[1] || '', got = 0;
      var re = /Content-Type:\s*([^;\r\n]+)[^]*?name="?([^"\r\n;]+)"?[^]*?Content-Transfer-Encoding:\s*base64[^]*?\r?\n\r?\n([A-Za-z0-9+\/=\r\n]+)/gi, m;
      while ((m = re.exec(text))) {
        var fname = m[2].replace(/=\?utf-8\?b\?([^?]+)\?=/i, function (_, b64) { try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return _; } }), fext = extOf(fname);
        if (!(isExcel(fext) || isPhoto(fext) || /^(zip|msg|pdf)$/.test(fext))) continue;
        try { var bin = atob(m[3].replace(/\s+/g, '')), u8 = new Uint8Array(bin.length); for (var j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j); got++;
          await expand(new File([u8], fname, { type:'' }), (via ? via + ' › ' : '') + file.name + (subj ? '「' + subj.trim() + '」' : ''), out, depth + 1); } catch (e) {}
      }
      if (!got) out.push({ file:file, via:via, unsupported:L('這封信沒有可匯入的附件', 'No importable attachment in this message', 'គ្មានឯកសារភ្ជាប់') });
      return;
    }
    if (isExcel(ext) || isPhoto(ext)) { out.push({ file:file, via:via }); return; }
    if (ext === 'pdf') { out.push({ file:file, via:via, unsupported:L('PDF 辨識下一階段提供（請先丟 Excel 或照片）', 'PDF recognition comes in the next stage (use Excel or a photo for now)', 'PDF នឹងមានពេលក្រោយ') }); return; }
    out.push({ file:file, via:via, unsupported:L('不支援的檔案類型', 'Unsupported file type', 'ប្រភេទឯកសារមិនគាំទ្រ') + ' .' + ext });
  }

  /* ── 判斷模組：回傳 [{tool,kind,score}] 高分在前；順便猜最常見的月份 ── */
  function readCtx(name, wb) {
    var ctx = { name:String(name || '').toLowerCase(), sheets:[], head:'', headc:'', months:{} };
    if (!wb) return ctx;
    (wb.SheetNames || []).slice(0, 12).forEach(function (sn) {
      var rows = [];
      try { rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header:1, defval:'', raw:true, blankrows:false }); } catch (_) {}
      ctx.sheets.push(String(sn).toLowerCase());
      var head = rows.slice(0, 15).map(function (r) { return (r || []).slice(0, 40).map(function (v) { return String(v == null ? '' : v); }).join(' '); }).join('\n').toLowerCase();
      ctx.head += '\n' + head.replace(/[\s\u3000]+/g, ' ');
      ctx.headc += '\n' + head.replace(/[\s\u3000_\-\/()（）:：.．]/g, '');
      rows.slice(0, 400).forEach(function (r) { (r || []).slice(0, 40).forEach(function (v) {
        if (v === '' || v == null) return;
        if (typeof v === 'number' && !(v > 36500 && v < 73050)) return;
        if (typeof v === 'string' && !/\d{4}[-\/.]\d{1,2}|\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}/.test(v)) return;
        var d = SEC.parseD(v); if (!d || d.getFullYear() < 2015 || d.getFullYear() > 2100) return;
        var k = d.getFullYear() + '-' + SEC.p2(d.getMonth() + 1); ctx.months[k] = (ctx.months[k] || 0) + 1;
      }); });
    });
    return ctx;
  }
  function detect(ctx, photo, bias) {
    var scores = {};
    RULES.forEach(function (r) {
      if (!!r.photo !== !!photo) return;
      var s = 0;
      if (r.name && r.name.test(ctx.name)) s += 3;
      if (!photo && r.sheet && ctx.sheets.some(function (x) { return r.sheet.test(x) || r.sheet.test(x.replace(/[\s\u3000_\-\/()（）:：.．]/g, '')); })) s += 2;
      if (!photo && r.head && (r.head.test(ctx.head) || r.head.test(ctx.headc))) s += 2;
      if (!s) return;
      var key = r.tool + '|' + r.kind; scores[key] = Math.max(scores[key] || 0, s) + (scores[key] ? 0.5 : 0);
    });
    if (bias && !photo) { var spec = SEC.importers()[bias]; if (spec) Object.keys(spec.kinds).forEach(function (k) { var key = bias + '|' + k; if (scores[key]) scores[key] += 0.5; }); }
    return Object.keys(scores).map(function (k) { var p = k.split('|'); return { tool:p[0], kind:p[1], score:scores[k] }; }).sort(function (a, b) { return b.score - a.score; });
  }
  function bestMonth(ctx) { var best = '', n = 0; Object.keys(ctx.months || {}).forEach(function (k) { if (ctx.months[k] > n) { n = ctx.months[k]; best = k; } }); return best; }

  /* ── 在目標視窗裡用該頁登記的匯入函式跑一個檔案 ── */
  async function runIn(w, tool, kind, file) {
    var spec = w.SEC.importers()[tool]; if (!spec) throw new Error(L('這一頁沒有登記匯入方式', 'This page has no importer registered', 'ទំព័រនេះមិនមាន'));
    var k = spec.kinds[kind] || spec.kinds[spec.default] || spec.kinds[Object.keys(spec.kinds)[0]]; if (!k) throw new Error('no kind');
    var notes = [], orig = w.SEC.toast, logEl = w.document.getElementById('impLog'), before = logEl ? logEl.innerHTML : '';
    w.SEC.toast = function (msg, kindCls) { try { notes.push({ text:stripTags(msg), kind:kindCls || '' }); } catch (_) {} return orig.apply(this, arguments); };
    var ab = await file.arrayBuffer(), u8 = new w.Uint8Array(ab.byteLength); u8.set(new Uint8Array(ab));
    var wf = new w.File([u8], file.name, { type:file.type || '', lastModified:file.lastModified || Date.now() });
    try { await w.SEC.importFromFiles([wf], function (f) { return k.run(f); }); }
    finally { w.SEC.toast = orig; }
    var log = logEl && logEl.innerHTML !== before ? stripTags(logEl.innerHTML) : '';
    var err = notes.filter(function (n) { return n.kind === 'err'; }).map(function (n) { return n.text; });
    return { ok:!err.length, notes:notes.map(function (n) { return n.text; }), log:log, error:err.join(' · ') };
  }
  /* ── 背景開模組頁 ── */
  function openFrame(tool) {
    return new Promise(function (resolve, reject) {
      var f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1; f.title = 'import ' + tool;
      f.style.cssText = 'position:fixed;left:-12000px;top:0;width:420px;height:860px;border:0;opacity:0;pointer-events:none';
      var to = setTimeout(function () { reject(new Error(L('模組頁開啟逾時', 'Module page timed out', 'អស់ពេល'))); }, 45000);
      f.onload = async function () {
        clearTimeout(to);
        try {
          var w = f.contentWindow;
          if (!(await waitFor(function () { return w.SEC && w.SEC.importers && w.SEC.importers()[tool] && w.SEC.importers()[tool].ready; }, 30000))) throw new Error(L('模組頁沒有準備好', 'Module page did not get ready', 'ទំព័រមិនរួចរាល់'));
          await w.SEC.importers()[tool].ready;
          /* 等開頁時的自動同步跑完，匯入不要跟下載合併撞在一起 */
          await waitFor(function () { var d = w.SEC.autoSyncDebug(); return !d.busy[tool]; }, 30000, 200);
          w.confirm = function (m) { return g.confirm('［' + toolName(tool) + '］\n' + m); };
          w.alert = function () {};
          resolve({ frame:f, win:w });
        } catch (e) { reject(e); }
      };
      f.src = TOOLS[tool].page + '?hubImport=1&_t=' + Date.now();
      document.body.appendChild(f);
    });
  }
  async function waitSynced(w, tool, since) {
    var out = { ok:false, text:'' };
    await waitFor(function () {
      var d = w.SEC.autoSyncDebug(), pend = null; try { pend = w.localStorage.getItem('ac_sec_auto_sync_' + tool); } catch (_) {}
      if (d.busy[tool]) return false;
      if ((d.lastRun[tool] || 0) < since) return false;
      var net = d.net[tool];
      if (net && net.ok === false) { out.ok = false; out.text = net.error || ''; return true; }
      if (!pend) { out.ok = true; return true; }
      return false;
    }, 150000, 500);
    return out;
  }

  /* ── 匯入中心本體 ── */
  function Hub(opt) {
    this.opt = opt || {}; this.tool = this.opt.tool || ''; this.items = []; this.busy = false; this.seq = 0; this.touched = {}; this.root = null;
  }
  Hub.prototype.mount = function (el) { this.root = el; el.classList.add('ihub'); this.render(); return this; };
  Hub.prototype.addFiles = async function (fileList) {
    var self = this, raw = Array.prototype.slice.call(fileList || []); if (!raw.length) return;
    var expanded = [];
    for (var i = 0; i < raw.length; i++) {
      var it0 = { id:++self.seq, name:raw[i].name, size:raw[i].size, state:'detect', msg:L('讀取中…', 'Reading…', 'កំពុងអាន…'), on:false, file:raw[i] };
      self.items.push(it0); self.render();
      try { var out = []; await expand(raw[i], '', out, 0); self.items.splice(self.items.indexOf(it0), 1); out.forEach(function (x) { expanded.push(x); }); }
      catch (e) { it0.state = 'err'; it0.on = false; it0.msg = String(e && e.message || e); }
      self.render();
    }
    var log = await logRead();
    for (var j = 0; j < expanded.length; j++) {
      var x = expanded[j], it = { id:++self.seq, name:x.file.name, via:x.via || '', size:x.file.size, file:x.file, state:'detect', msg:'', on:false, tool:'', kind:'', cands:[], month:'' };
      self.items.push(it); self.render();
      if (x.unsupported) { it.state = 'skip'; it.msg = x.unsupported; self.render(); continue; }
      try {
        var ext = extOf(it.name), buf = await x.file.arrayBuffer(); it.hash = await hashOf(buf); it.photo = isPhoto(ext);
        var ctx;
        if (it.photo) ctx = readCtx(it.name, null);
        else { await xlsx(); var wb = XLSX.read(new Uint8Array(buf), { type:'array', cellDates:false, raw:true, sheetRows:400 }); ctx = readCtx(it.name, wb); it.month = bestMonth(ctx); }
        it.cands = detect(ctx, it.photo, self.tool);
        var best = it.cands[0], second = it.cands[1];
        if (best && best.score >= 3 && (!second || best.score - second.score >= 1)) { it.tool = best.tool; it.kind = best.kind; it.state = 'ready'; it.on = true; }
        else if (best) { it.tool = best.tool; it.kind = best.kind; it.state = 'ask'; it.msg = L('不太確定是哪個模組，請確認', 'Not sure which module — please confirm', 'សូមបញ្ជាក់ម៉ូឌុល'); }
        else if (self.tool && !it.photo && SEC.importers()[self.tool]) { it.tool = self.tool; it.kind = SEC.importers()[self.tool].default || Object.keys(SEC.importers()[self.tool].kinds)[0]; it.state = 'ask'; it.msg = L('認不出表格，預設匯入本頁模組，請確認', 'Could not recognise the sheet; defaulting to this module — please confirm', 'សូមបញ្ជាក់'); }
        else { it.state = 'ask'; it.msg = L('認不出是哪個模組，請選擇', 'Could not tell the module — please choose', 'សូមជ្រើសម៉ូឌុល'); }
        var prev = it.hash && log[it.hash];
        if (prev) { it.on = false; it.state = 'done-before'; it.prev = prev; it.msg = L('此檔 ' + when(prev.at) + ' 已匯入過（' + destLabel(prev.tool, prev.kind) + '）→ 0 新增；要重匯請打勾', 'Already imported ' + when(prev.at) + ' (' + destLabel(prev.tool, prev.kind) + ') → 0 new; tick to import again', 'បាននាំចូល ' + when(prev.at) + ' → 0 ថ្មី'); }
      } catch (e) { it.state = 'err'; it.msg = L('讀不到檔案：', 'Cannot read: ', 'អានមិនបាន: ') + String(e && e.message || e); }
      self.render();
    }
  };
  Hub.prototype.run = async function () {
    var self = this; if (self.busy) return;
    var todo = self.items.filter(function (it) { return it.on && it.tool && TOOLS[it.tool] && it.state !== 'run'; });
    if (!todo.length) { SEC.toast(L('沒有勾選要匯入的檔案', 'Nothing ticked to import', 'គ្មានឯកសារ'), 'warn'); return; }
    if (!navigator.onLine) { SEC.toast(SEC.netFailText(), 'err', 0); return; }
    self.busy = true; self.touched = {}; self.render();
    var photos = todo.filter(function (it) { return it.photo; }), excels = todo.filter(function (it) { return !it.photo; });
    var log = await logRead(), frames = {};
    try {
      for (var oi = 0; oi < ORDER.length; oi++) {
        var tool = ORDER[oi], list = excels.filter(function (it) { return it.tool === tool; }); if (!list.length) continue;
        var w = null, fr = null, since = Date.now();
        try {
          if (tool === self.tool && SEC.importers()[tool]) { w = g; }
          else { fr = await openFrame(tool); w = fr.win; frames[tool] = fr; }
          for (var i = 0; i < list.length; i++) {
            var it = list[i]; it.state = 'run'; it.msg = L('匯入中…', 'Importing…', 'កំពុងនាំចូល…'); self.render();
            try {
              var r = await runIn(w, tool, it.kind, it.file);
              var last = r.error || r.notes.slice(-1)[0] || L('已處理', 'Done', 'រួច');
              it.state = r.ok ? 'ok' : 'err'; it.msg = (/^[✅❌⚠ℹ]/.test(last) ? '' : (r.ok ? '✅ ' : '❌ ')) + last; it.log = r.log; it.on = false;
              if (r.ok) { log[it.hash] = { name:it.name, tool:tool, kind:it.kind, at:Date.now(), result:it.msg }; var tk = self.touched[tool] || (self.touched[tool] = { months:{}, kinds:{} }); if (it.month) tk.months[it.month] = 1; tk.kinds[it.kind] = 1; }
            } catch (e) { it.state = 'err'; it.msg = '❌ ' + String(e && e.message || e); }
            self.render();
          }
          /* 等該模組的自動同步把資料送上雲端 */
          var sync = await waitSynced(w, tool, since);
          list.forEach(function (it) { if (it.state === 'ok') it.msg += sync.ok ? ' · ☁ ' + L('已上雲', 'uploaded', 'បានដាក់ពពក') : ' · ⚠ ' + L('雲端尚未確認，模組會自動重試', 'cloud not confirmed yet; the module will retry', 'ពពកមិនទាន់បញ្ជាក់') + (sync.text ? '（' + sync.text + '）' : ''); });
        } catch (e) { list.forEach(function (it) { if (it.state !== 'ok') { it.state = 'err'; it.msg = '❌ ' + String(e && e.message || e); } }); }
        finally { if (fr) setTimeout(function (f) { try { f.frame.src = 'about:blank'; f.frame.remove(); } catch (_) {} }.bind(null, fr), 300); }
        self.render();
      }
      await logWrite(log);
      if (photos.length) await self.handoffPhotos(photos);
    } finally { self.busy = false; self.render(); }
    var bad = self.items.filter(function (it) { return it.state === 'err'; }).length;
    SEC.toast(bad ? '⚠ ' + L('匯入完成，' + bad + ' 個檔案失敗', 'Done; ' + bad + ' file(s) failed', 'រួច; ' + bad + ' បរាជ័យ') : '✅ ' + L('匯入並上傳完成', 'Imported and uploaded', 'បាននាំចូល និងដាក់ពពក'), bad ? 'warn' : 'ok', 4000);
    if (typeof self.opt.onDone === 'function') try { self.opt.onDone(self.touched); } catch (_) {}
  };
  /* 照片：OCR 要人核對，所以到通勤頁去跑（本頁就是通勤頁則直接跑） */
  Hub.prototype.handoffPhotos = async function (photos) {
    var self = this, byKind = {};
    photos.forEach(function (it) { (byKind[it.kind] || (byKind[it.kind] = [])).push(it); });
    var kinds = Object.keys(byKind);
    if (self.tool === 'commute' && SEC.importers().commute) {
      for (var i = 0; i < kinds.length; i++) {
        var list = byKind[kinds[i]];
        for (var j = 0; j < list.length; j++) { var it = list[j]; it.state = 'run'; self.render(); try { var r = await runIn(g, 'commute', kinds[i], it.file); it.state = r.ok ? 'ok' : 'err'; it.msg = (r.ok ? '✅ ' : '❌ ') + (r.error || L('已送到辨識視窗，請核對後儲存', 'Sent to the recognition window — review and save', 'សូមពិនិត្យ')); } catch (e) { it.state = 'err'; it.msg = '❌ ' + String(e && e.message || e); } it.on = false; self.render(); }
      }
      return;
    }
    var pack = [];
    for (var p = 0; p < photos.length; p++) pack.push({ name:photos[p].name, kind:photos[p].kind, blob:photos[p].file });
    await SEC.dbPut(HANDOFF_KEY, { tool:'commute', at:Date.now(), files:pack });
    photos.forEach(function (it) { it.state = 'ok'; it.on = false; it.msg = '📷 ' + L('照片要到通勤頁辨識並核對', 'Photos are recognised on the Commute page for review', 'រូបថតត្រូវពិនិត្យនៅទំព័រដំណើរ'); });
    self.render();
    SEC.toast('📷 ' + L('照片將在通勤頁辨識，正在前往…', 'Opening the Commute page to recognise the photos…', 'កំពុងបើកទំព័រដំណើរ…'), 'ok', 2500);
    setTimeout(function () { location.href = TOOLS.commute.page + '?hub=1'; }, 900);
  };
  /* 通勤頁開啟時接手照片 */
  async function takeHandoff() {
    if (!/[?&]hub=1/.test(location.search)) return;
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    var h = await SEC.dbGet(HANDOFF_KEY, null); if (!h || !h.files || !h.files.length || Date.now() - (h.at || 0) > 600000) return;
    await SEC.dbPut(HANDOFF_KEY, null);
    var spec = SEC.importers()[h.tool]; if (!spec) return; await spec.ready;
    for (var i = 0; i < h.files.length; i++) {
      var f = h.files[i], file = f.blob instanceof File ? f.blob : new File([f.blob], f.name, { type:f.blob && f.blob.type || '' });
      try { await SEC.importFromFiles([file], function (x) { return spec.kinds[f.kind].run(x); }); } catch (e) { SEC.toast('❌ ' + esc(String(e && e.message || e)), 'err', 0); }
      /* 一次一張：等辨識視窗關掉再下一張 */
      await waitFor(function () { var m = document.getElementById('mCommuteOcr'); return !m || !m.classList.contains('on'); }, 600000, 500);
    }
  }
  Hub.prototype.clear = function () { if (this.busy) return; this.items = []; this.touched = {}; this.render(); };
  Hub.prototype.actions = function () {
    var self = this, out = [];
    Object.keys(self.touched).forEach(function (tool) {
      var t = self.touched[tool], months = Object.keys(t.months).sort(), d = TOOLS[tool];
      var m = months.length ? months[months.length - 1] : '';
      out.push({ tool:tool, label:'✈️ ' + L('發摘要', 'Send summary', 'ផ្ញើសង្ខេប') + '：' + toolName(tool) + (m ? ' ' + m : ''), href:d.page + '?tg=summary&ptype=month' + (m ? '&period=' + m : '') });
      if (d.approval || (tool === 'commute' && t.kinds.car)) out.push({ tool:tool, label:'✅ ' + L('核可', 'Approval', 'អនុម័ត') + '：' + toolName(tool) + (m ? ' ' + m : ''), href:d.page + '?tg=approval&ptype=month' + (m ? '&period=' + m : '') });
    });
    return out;
  };
  Hub.prototype.render = function () {
    var self = this, r = self.root; if (!r) return;
    var any = self.items.length, canRun = !self.busy && self.items.some(function (it) { return it.on && it.tool; });
    var html = '<div class="ihub-drop" data-drop tabindex="0" role="button">' +
      '<b>⇧ ' + esc(L('把檔案拖進來，或點這裡選檔（可多檔）', 'Drop files here or tap to choose (multiple OK)', 'ទម្លាក់ឯកសារ ឬចុចជ្រើស')) + '</b>' +
      '<small>' + esc(L('Excel／CSV、Outlook .msg／.eml（自動取附件）、zip（自動解開）、照片（通勤四種表單）。系統自己判斷模組，判不出來才問。同一個檔再丟＝0 新增。', 'Excel/CSV, Outlook .msg/.eml (attachments taken), zip (unpacked), photos (the four commute forms). The module is detected automatically; you are asked only when unsure. Dropping the same file again = 0 new.', 'Excel/CSV, .msg/.eml, zip, រូបថត។ ប្រព័ន្ធកំណត់ម៉ូឌុលដោយស្វ័យប្រវត្តិ។')) + '</small>' +
      '<input type="file" multiple hidden data-file accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.msg,.eml,.zip,.pdf,image/*"></div>';
    if (any) {
      html += '<div class="ihub-list">' + self.items.map(function (it) {
        var dest = '';
        if (it.state !== 'skip' && it.state !== 'err' && it.state !== 'detect') {
          var opts = [];
          ORDER.forEach(function (tool) {
            var spec = null; try { spec = SEC.importers()[tool]; } catch (_) {}
            var kinds = it.photo ? ['car', 'bike', 'gate', 'late'] : (RULES.filter(function (x) { return x.tool === tool && !x.photo; }).map(function (x) { return x.kind; }).filter(function (v, i, a) { return a.indexOf(v) === i; }));
            if (it.photo && tool !== 'commute') return;
            kinds.forEach(function (k) { opts.push('<option value="' + tool + '|' + k + '"' + (it.tool === tool && it.kind === k ? ' selected' : '') + '>' + esc(destLabel(tool, k)) + '</option>'); });
          });
          dest = '<select data-dest="' + it.id + '"' + (self.busy ? ' disabled' : '') + '><option value=""' + (!it.tool ? ' selected' : '') + '>' + esc(L('— 選擇模組 —', '— choose module —', '— ជ្រើស —')) + '</option>' + opts.join('') + '</select>';
        }
        var cls = it.state === 'ok' ? 'ok' : it.state === 'err' ? 'err' : it.state === 'run' ? 'run' : it.state === 'done-before' ? 'dup' : it.state === 'ask' ? 'ask' : '';
        return '<div class="ihub-row ' + cls + '"><input type="checkbox" data-on="' + it.id + '"' + (it.on ? ' checked' : '') + ((self.busy || it.state === 'skip' || it.state === 'err' || it.state === 'run' || it.state === 'ok') ? ' disabled' : '') + '>' +
          '<div class="ihub-name">' + esc(it.name) + '<small>' + (it.via ? esc(it.via) + ' · ' : '') + kb(it.size || 0) + (it.month ? ' · 📅 ' + it.month : '') + '</small></div>' + dest +
          (it.msg ? '<div class="ihub-msg ' + cls + '">' + esc(it.msg) + '</div>' : '') +
          (it.log ? '<details class="ihub-log"><summary>' + esc(L('匯入記錄', 'Import log', 'កំណត់ហេតុ')) + '</summary><pre>' + esc(it.log) + '</pre></details>' : '') + '</div>';
      }).join('') + '</div>';
      html += '<div class="ihub-bar"><button type="button" class="btn gray sm" data-clear' + (self.busy ? ' disabled' : '') + '>🧹 ' + esc(L('清除清單', 'Clear', 'សម្អាត')) + '</button>' +
        '<button type="button" class="btn" data-run' + (canRun ? '' : ' disabled') + '>' + (self.busy ? '⏳ ' + esc(L('匯入中…', 'Importing…', 'កំពុងនាំចូល…')) : '⇧ ' + esc(L('匯入勾選的', 'Import ticked', 'នាំចូលដែលបានធីក'))) + '</button></div>';
    }
    var acts = self.actions();
    if (!self.busy && acts.length) html += '<div class="ihub-acts"><div class="ihub-acts-t">' + esc(L('匯好了，接下來？（會先看到預覽，再按發送）', 'Done. Next? (you will see a preview before sending)', 'រួច។ បន្ទាប់?')) + '</div>' +
      acts.map(function (a) { return '<a class="btn sm" href="' + esc(a.href) + '">' + esc(a.label) + '</a>'; }).join('') + '</div>';
    r.innerHTML = html;
    var drop = r.querySelector('[data-drop]'), inp = r.querySelector('[data-file]');
    drop.onclick = function (e) { if (e.target !== inp) inp.click(); };
    drop.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } };
    inp.onchange = function () { self.addFiles(inp.files); inp.value = ''; };
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var fs = e.dataTransfer && e.dataTransfer.files; if (fs && fs.length) self.addFiles(fs); });
    r.querySelectorAll('[data-on]').forEach(function (cb) { cb.onchange = function () { var it = self.items.filter(function (x) { return String(x.id) === cb.getAttribute('data-on'); })[0]; if (it) { it.on = cb.checked; if (it.state === 'done-before' && it.on) it.msg = L('將重新匯入（已有的紀錄不會重複）', 'Will import again (existing records are not duplicated)', 'នឹងនាំចូលម្តងទៀត'); } self.render(); }; });
    r.querySelectorAll('[data-dest]').forEach(function (sel) { sel.onchange = function () { var it = self.items.filter(function (x) { return String(x.id) === sel.getAttribute('data-dest'); })[0]; if (!it) return; var p = sel.value.split('|'); it.tool = p[0] || ''; it.kind = p[1] || ''; if (it.tool && it.state === 'ask') { it.state = 'ready'; it.on = true; it.msg = ''; } if (!it.tool) { it.on = false; } self.render(); }; });
    var run = r.querySelector('[data-run]'); if (run) run.onclick = function () { self.run(); };
    var clr = r.querySelector('[data-clear]'); if (clr) clr.onclick = function () { self.clear(); };
  };

  var CSS = '.ihub{display:flex;flex-direction:column;gap:10px}' +
    '.ihub-drop{border:2px dashed #9cc7dc;background:#eef6fa;border-radius:12px;padding:16px 12px;text-align:center;cursor:pointer;color:#3d5a73;font-size:13px}' +
    '.ihub-drop.over,.ihub-drop:hover{border-color:#1e6f8e;background:#e0f0f7}.ihub-drop b{display:block;color:#1e6f8e;font-size:14px}.ihub-drop small{display:block;margin-top:5px;font-size:11px;color:#6b8398;line-height:1.5}' +
    '.ihub-list{display:flex;flex-direction:column;gap:7px}' +
    '.ihub-row{display:flex;align-items:center;gap:8px;border:1px solid #dde6ee;border-radius:10px;padding:8px 10px;flex-wrap:wrap;background:#fff}' +
    '.ihub-row.ok{border-color:#86efac;background:#f0fdf4}.ihub-row.err{border-color:#fca5a5;background:#fef2f2}.ihub-row.run{border-color:#fcd34d;background:#fffbeb}.ihub-row.dup{border-color:#cbd5e1;background:#f8fafc}.ihub-row.ask{border-color:#fbbf24}' +
    '.ihub-row input[type=checkbox]{width:18px;height:18px;flex:none;accent-color:#1e6f8e}' +
    '.ihub-name{flex:1;min-width:150px;font-size:13px;font-weight:700;color:#15293d;word-break:break-all}.ihub-name small{display:block;font-weight:500;color:#6b8398;font-size:11px}' +
    '.ihub-row select{border:1px solid #cfdbe6;border-radius:8px;padding:7px 8px;font-size:12.5px;min-height:38px;max-width:100%;background:#fff;font-family:inherit}' +
    '.ihub-msg{flex-basis:100%;font-size:11.5px;color:#5b7186;padding-left:26px;line-height:1.45}.ihub-msg.ok{color:#047857}.ihub-msg.err{color:#b91c1c}.ihub-msg.run{color:#b45309}.ihub-msg.ask{color:#b45309}' +
    '.ihub-log{flex-basis:100%;padding-left:26px;font-size:11px}.ihub-log pre{white-space:pre-wrap;background:#f8fafc;border-radius:8px;padding:8px;margin:4px 0 0;max-height:160px;overflow:auto;font-size:10.5px;line-height:1.4}' +
    '.ihub-bar{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}' +
    '.ihub-acts{border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ihub-acts-t{flex-basis:100%;font-size:12px;font-weight:700;color:#1e3a5f}' +
    '.ihub-acts .btn{text-decoration:none}' +
    '.hub-mask .modal{max-width:640px}.ic-btn.hub-btn{background:linear-gradient(135deg,#f5c842,#e0b73a);color:#12283d;border-color:rgba(255,255,255,.4)}.ic-btn.hub-btn .ic-i{font-weight:900}';
  function css() { if (document.getElementById('sec-hub-css')) return; var s = document.createElement('style'); s.id = 'sec-hub-css'; s.textContent = CSS; document.head.appendChild(s); }
  var modalHub = null;
  function open(opt) {
    css(); opt = opt || {};
    var mask = document.createElement('div'); mask.className = 'mask on hub-mask'; mask.style.zIndex = 3100;
    mask.innerHTML = '<div class="modal"><div class="mh"><span>⇧</span><b>' + esc(L('智慧匯入', 'Smart import', 'នាំចូលឆ្លាតវៃ')) + (opt.tool && TOOLS[opt.tool] ? ' · ' + esc(toolName(opt.tool)) : '') + '</b><button class="x" data-close aria-label="close">×</button></div>' +
      '<div class="mb"><div data-hub></div></div></div>';
    document.body.appendChild(mask);
    var hub = new Hub({ tool:opt.tool || '', onDone:opt.onDone });
    hub.mount(mask.querySelector('[data-hub]'));
    var close = function () { if (hub.busy && !g.confirm(L('匯入還在進行，確定關閉？', 'Import is still running. Close anyway?', 'កំពុងនាំចូល បិទមែនទេ?'))) return; mask.remove(); if (modalHub === hub) modalHub = null; if (typeof opt.onClose === 'function') opt.onClose(hub.touched); };
    mask.querySelector('[data-close]').onclick = close;
    mask.onclick = function (e) { if (e.target === mask) close(); };
    modalHub = hub; mask.__hub = hub;
    return hub;
  }
  function mount(el, opt) { css(); var hub = new Hub(opt || {}); hub.mount(typeof el === 'string' ? document.querySelector(el) : el); return hub; }
  SEC.ImportHub = { open:open, mount:mount, runIn:runIn, detect:detect, readCtx:readCtx, expand:expand, RULES:RULES, RULES_BY_TOOL:RULES_BY_TOOL, TOOLS:TOOLS, KIND_LABEL:KIND_LABEL, takeHandoff:takeHandoff, LOG_KEY:LOG_KEY, HANDOFF_KEY:HANDOFF_KEY, css:css };
  css();
  /* 本頁是從首頁丟照片過來的：等頁面登記好匯入器就接手 */
  if (/[?&]hub=1/.test(location.search)) SEC.dataReady().then(function () { return waitFor(function () { var im = SEC.importers(); return Object.keys(im).length; }, 20000); }).then(takeHandoff).catch(function () {});
})(window);
