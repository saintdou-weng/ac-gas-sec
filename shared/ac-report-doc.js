/* AC 平台共用「參考報告」Word 產生器（2026-10-22）
 * 仿 VRT PROD sewing 週報版面：VRT 抬頭、藍色標題、navy 表頭表格、頁首頁尾頁碼、製表／審核／核准簽名欄。
 * 不依賴任何平台核心：傳入 docx（docx 8.x IIFE）與一個 model，回傳 docx.Document。
 * model = {
 *   lang:'zh-en'|'en-km',                     // 兩語並列
 *   company:'…', title:[a,b], typeName:[a,b], periodLabel:'2026-09', scopeLabel:[a,b] (optional), generatedAt:'…',
 *   notice:[ [a,b], … ]  (optional 黃底提醒),
 *   sections:[ { title:[a,b], bullets:[ [a,b,dotColor?], … ], paragraphs:[ [a,b], … ],
 *               table:{ widths:[dxa…], head:[ [a,b]|'x', … ], rows:[ [cell,…], … ], rowOpts:[ {fill,bold,colors}, … ] } } … ],
 *   signature:true|false
 * }
 * 每個 [a,b] 都是「語言 A、語言 B」兩段文字（zh-en 就是中文、英文；en-km 就是英文、柬文）。 */
(function (g) {
  'use strict';
  if (g.ACReportDoc) return;
  var NAVY = '1F3864', GRAY = '595959', LBLUE = 'DEEAF6', LYEL = 'FFF2CC';
  var FONT = { ascii:'Arial', hAnsi:'Arial', eastAsia:'Microsoft JhengHei', cs:'Khmer UI' };
  function pair(v) { if (Array.isArray(v)) return [String(v[0] == null ? '' : v[0]), String(v[1] == null ? '' : v[1])]; return [String(v == null ? '' : v), '']; }
  function build(docx, m) {
    m = m || {};
    var T = function (t, o) { o = o || {}; return new docx.TextRun({ text:String(t == null ? '' : t), font:FONT, size:o.size || 19, bold:!!o.bold, italics:!!o.i, color:o.color || '000000' }); };
    var PP = function (r, o) { o = o || {}; return new docx.Paragraph({ children:Array.isArray(r) ? r : [r], alignment:o.align, spacing:{ before:o.before === undefined ? 60 : o.before, after:o.after === undefined ? 60 : o.after, line:264 } }); };
    var H = function (p) { p = pair(p); return new docx.Paragraph({ children:[T(p[0], { bold:true, size:26, color:NAVY }), T(p[1] ? '  ' + p[1] : '', { bold:true, size:20, color:NAVY, i:true })], spacing:{ before:320, after:140 }, border:{ bottom:{ style:docx.BorderStyle.SINGLE, size:12, color:NAVY, space:4 } } }); };
    var bi = function (p, dot) { p = pair(p); var first = []; if (dot) first.push(T('● ', { color:dot, bold:true })); first.push(T(p[0])); var out = [PP(first, { after:p[1] ? 20 : 70 })]; if (p[1]) out.push(PP(T(p[1], { size:17, color:'3B3B3B', i:true }), { before:0, after:90 })); return out; };
    var cl = function (t, o) { o = o || {}; var lines = String(t == null ? '' : t).split('\n'); return new docx.TableCell({ width:{ size:o.w, type:docx.WidthType.DXA }, shading:o.fill ? { type:docx.ShadingType.CLEAR, fill:o.fill, color:'auto' } : undefined, margins:{ top:60, bottom:60, left:90, right:90 }, verticalAlign:docx.VerticalAlign.CENTER,
      children:lines.map(function (s, i) { return new docx.Paragraph({ children:[T(s, { bold:o.bold, color:o.color, size:o.size || (i ? 14 : 16), i:i > 0 && !o.bold })], alignment:o.align, spacing:{ before:20, after:20, line:252 } }); }) }); };
    var tb = function (w, rows) { var B = { style:docx.BorderStyle.SINGLE, size:4, color:'BFBFBF' }, I = { style:docx.BorderStyle.SINGLE, size:3, color:'D9D9D9' }; return new docx.Table({ columnWidths:w, width:{ size:w.reduce(function (a, b) { return a + b; }, 0), type:docx.WidthType.DXA }, borders:{ top:B, bottom:B, left:B, right:B, insideHorizontal:I, insideVertical:I }, rows:rows }); };
    var hr = function (w, l) { return new docx.TableRow({ tableHeader:true, children:l.map(function (x, i) { var p = pair(x); return cl(p[1] ? p[0] + '\n' + p[1] : p[0], { w:w[i], fill:NAVY, bold:true, color:'FFFFFF', align:docx.AlignmentType.CENTER }); }) }); };
    var dr = function (w, v, o) { o = o || {}; return new docx.TableRow({ cantSplit:true, children:v.map(function (x, i) { var co = o.colors && o.colors[i], p = pair(x); return cl(p[1] ? p[0] + '\n' + p[1] : p[0], { w:w[i], fill:o.fill, bold:o.bold || (o.boldCols && o.boldCols[i]), color:co, align:i === 0 && !o.all ? undefined : docx.AlignmentType.CENTER }); }) }); };
    var body = [], add = function () { for (var i = 0; i < arguments.length; i++) { var x = arguments[i]; if (Array.isArray(x)) body.push.apply(body, x); else body.push(x); } };
    var title = pair(m.title), typeName = pair(m.typeName), scope = m.scopeLabel ? pair(m.scopeLabel) : null;
    add(PP(T(m.company || 'VANTAGE RIVER TEXTILES CO., LTD.　萬泰紡織有限公司', { bold:true, size:16, color:GRAY }), { align:docx.AlignmentType.CENTER, after:20 }),
      PP(T(title[0] + ' ' + typeName[0], { bold:true, size:31, color:NAVY }), { align:docx.AlignmentType.CENTER, before:40, after:10 }),
      PP(T((title[1] + ' ' + typeName[1]).trim(), { bold:true, size:19, color:NAVY, i:true }), { align:docx.AlignmentType.CENTER, after:30 }),
      PP(T((m.periodPrefix || 'Period') + ' ' + (m.periodLabel || '') + (scope ? '　|　' + scope[0] + (scope[1] ? ' / ' + scope[1] : '') : '') + (m.generatedAt ? '　|　' + m.generatedAt : ''), { size:16, color:GRAY }), { align:docx.AlignmentType.CENTER, after:140 }));
    if (m.notice && m.notice.length) add(tb([9700], [new docx.TableRow({ children:[new docx.TableCell({ width:{ size:9700, type:docx.WidthType.DXA }, shading:{ type:docx.ShadingType.CLEAR, fill:LYEL, color:'auto' }, margins:{ top:110, bottom:110, left:160, right:160 },
      children:m.notice.map(function (n) { var p = pair(n); return PP([T('⚠ ' + p[0], { bold:true, size:17, color:'7F6000' }), T(p[1] ? '  ' + p[1] : '', { size:15, color:'7F6000', i:true })], { before:10, after:10 }); }) })] })]));
    (m.sections || []).forEach(function (sec) {
      add(H(sec.title));
      (sec.bullets || []).forEach(function (b) { add(bi(b, b && b[2])); });
      (sec.paragraphs || []).forEach(function (p) {
        var q = pair(p), h = Array.isArray(p) && p[2] === 'h';
        if (h) { add(PP([T(q[0], { bold:true, size:21, color:NAVY }), T(q[1] ? '  ' + q[1] : '', { bold:true, size:17, color:NAVY, i:true })], { before:160, after:60 })); return; }
        add(PP(T(q[0]), { after:q[1] ? 10 : 60 })); if (q[1]) add(PP(T(q[1], { size:17, color:'3B3B3B', i:true }), { before:0, after:80 }));
      });
      if (sec.table && sec.table.rows && sec.table.rows.length) {
        var w = sec.table.widths && sec.table.widths.length === sec.table.head.length ? sec.table.widths : sec.table.head.map(function () { return Math.floor(9700 / sec.table.head.length); });
        add(tb(w, [hr(w, sec.table.head)].concat(sec.table.rows.map(function (r, i) { var o = sec.table.rowOpts && sec.table.rowOpts[i] || {}; return dr(w, r, { fill:o.fill === 'blue' ? LBLUE : o.fill === 'yellow' ? LYEL : o.fill, bold:o.bold, colors:o.colors, boldCols:o.boldCols, all:o.all }); }))));
        if (sec.table.note) add(PP(T(pair(sec.table.note)[0] + (pair(sec.table.note)[1] ? '  ' + pair(sec.table.note)[1] : ''), { size:15, color:GRAY, i:true }), { before:40 }));
      } else if (sec.table && sec.table.empty) add(bi(sec.table.empty));
    });
    if (m.signature !== false) {
      var w7 = [3233, 3233, 3234], sg = m.signature && typeof m.signature === 'object' ? m.signature : {};
      add(PP(T(''), { before:200 }), tb(w7, [hr(w7, [sg.prepared || ['製表', 'Prepared by'], sg.reviewed || ['審核', 'Reviewed by'], sg.approved || ['核准', 'Approved by']]), dr(w7, ['\n\n____________________', '\n\n____________________', '\n\n____________________'], { all:true })]));
    }
    var hdrTxt = (m.headerText || ('VRT　' + title[0] + ' ' + typeName[0] + '　' + (m.periodLabel || ''))).trim();
    return new docx.Document({ styles:{ default:{ document:{ run:{ font:FONT, size:19 } } } }, sections:[{ properties:{ page:{ size:{ width:11906, height:16838 }, margin:{ top:1000, bottom:1000, left:1080, right:1080, header:560, footer:560 } } },
      headers:{ default:new docx.Header({ children:[new docx.Paragraph({ children:[T(hdrTxt, { size:15, color:GRAY })], alignment:docx.AlignmentType.RIGHT, border:{ bottom:{ style:docx.BorderStyle.SINGLE, size:4, color:'BFBFBF', space:4 } }, spacing:{ after:100 } })] }) },
      footers:{ default:new docx.Footer({ children:[new docx.Paragraph({ alignment:docx.AlignmentType.CENTER, children:[T((m.footerText || 'Vantage River Textiles Co., Ltd.　Confidential') + '　|　', { size:14, color:GRAY }), new docx.TextRun({ children:[docx.PageNumber.CURRENT], font:FONT, size:14, color:GRAY }), T(' / ', { size:14, color:GRAY }), new docx.TextRun({ children:[docx.PageNumber.TOTAL_PAGES], font:FONT, size:14, color:GRAY })] })] }) },
      children:body }] });
  }
  /* 按需載入 docx 程式庫（本機 shared/docx.iife.js，失敗再試備援網址） */
  function loadDocx(srcs) {
    if (g.docx && g.docx.Document) return Promise.resolve(g.docx);
    return new Promise(function (res, rej) {
      var tried = 0, list = srcs && srcs.length ? srcs : ['shared/docx.iife.js?v=8.5.0'];
      (function next() {
        if (tried >= list.length) return rej(new Error('Word library failed to load'));
        var s = document.createElement('script'); s.src = list[tried++];
        s.onload = function () { g.docx && g.docx.Document ? res(g.docx) : next(); }; s.onerror = next; document.head.appendChild(s);
      })();
    });
  }
  function download(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  g.ACReportDoc = { build:build, loadDocx:loadDocx, download:download, pair:pair };
})(window);
