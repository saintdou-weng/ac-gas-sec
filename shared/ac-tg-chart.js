/* ac-tg-chart.js — Telegram 摘要附圖（AC SEC 與 GASCheck 共用）2026-11-03（11-06 加 table 清單表格、grid 週檢查表）
   純 canvas，不用外部套件；輸出 PNG dataURL，當摘要第一頁的照片附上。
   ACChart.render({ title, subtitle, theme:'navy'|'green', blocks:[ ... ], footer })
   block.type:
     'donut'  { title, items:[{label,value,color}], center, centerSub }        圓環＋圖例（比例）
     'bars'   { title, items:[{label,value,color,text}], max, unit }           橫條（數量比較）
     'columns'{ title, items:[{label,value,color}], unit }                    直條（分布／趨勢）
     'stats'  { items:[{label,value,color,sub}] }                              大數字列
     'table'  { title, head:[..], rows:[[..]], align:['l','r',..], widths:[..], total:[..] }  清單表格（像餐費的部門表）
     'grid'   { title, cols:[{label,sub}], rows:[{label,cells:[{text,sub,color}]}], legend:[{label,color}] }
                                                                               週檢查表：橫列＝日期，直行＝區域，格子上色（綠＝正常、紅＝異常、灰＝沒檢查）
   回傳 '' 表示無法畫（例如沒有 canvas）。 */
(function (root) {
  'use strict';
  var THEMES = {
    navy:  { head:'#102a43', head2:'#1e5f8e', accent:'#2b8fbd', text:'#1b2b3a', muted:'#6b8398', grid:'#e6edf3', bg:'#ffffff', card:'#f7fafc' },
    green: { head:'#0f3d2e', head2:'#1e6b4e', accent:'#2e9c6a', text:'#1b2b24', muted:'#6b8a7c', grid:'#e4efe9', bg:'#ffffff', card:'#f5faf7' }
  };
  var PALETTE = ['#2b8fbd', '#2e9c6a', '#f2a93b', '#e35d5b', '#8e6cc9', '#3fb9c9', '#c97c2e', '#6c8ea4', '#d45fa0', '#55a630'];
  var FONT = '"Segoe UI", "Noto Sans", "Noto Sans CJK TC", "Noto Sans Khmer", "Khmer UI", "Leelawadee UI", "PingFang TC", "Microsoft JhengHei", Arial, sans-serif';
  function f(size, bold) { return (bold ? '600 ' : '400 ') + size + 'px ' + FONT; }
  function round(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fit(ctx, s, maxW) { s = String(s == null ? '' : s); if (ctx.measureText(s).width <= maxW) return s; while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
  function fmt(v) { v = +v || 0; return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits:0 }) : (Math.round(v * 10) / 10).toString(); }
  function color(item, i) { return item.color || PALETTE[i % PALETTE.length]; }

  function heightOf(b) {
    var n = (b.items || b.rows || []).length;
    if (b.type === 'donut') return Math.max(230, 70 + n * 28);
    if (b.type === 'bars') return 60 + Math.max(1, n) * 34;
    if (b.type === 'columns') return 250;
    if (b.type === 'stats') return 110;
    if (b.type === 'table') return 60 + 34 + Math.max(1, n) * 32 + (b.total ? 36 : 0) + (b.note ? 26 : 0);
    if (b.type === 'grid') { var two = (b.rows || []).some(function (r) { return (r.cells || []).some(function (c) { return c && c.sub; }); }); return 60 + 46 + Math.max(1, n) * (two ? 54 : 40) + ((b.legend || []).length ? 34 : 0); }
    return 120;
  }
  function drawDonut(ctx, T, b, x, y, w, h) {
    var items = (b.items || []).filter(function (it) { return +it.value > 0; }), total = items.reduce(function (a, it) { return a + (+it.value || 0); }, 0);
    var r = Math.min(h - 70, 170) / 2, cx = x + 20 + r, cy = y + 50 + r, a0 = -Math.PI / 2;
    ctx.lineWidth = Math.max(18, r * 0.36);
    if (!total) { ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke(); }
    items.forEach(function (it, i) {
      var a1 = a0 + (it.value / total) * Math.PI * 2;
      ctx.strokeStyle = color(it, i); ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, a0 + 0.015, a1 - 0.015); ctx.stroke(); a0 = a1;
    });
    ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = f(26, true); ctx.fillText(b.center != null ? String(b.center) : fmt(total), cx, cy - (b.centerSub ? 10 : 0));
    if (b.centerSub) { ctx.font = f(13); ctx.fillStyle = T.muted; ctx.fillText(fit(ctx, b.centerSub, r * 1.5), cx, cy + 16); }
    var lx = cx + r + 26, ly = y + 52, lw = x + w - lx - 10;
    ctx.textAlign = 'left';
    (b.items || []).forEach(function (it, i) {
      var pct = total ? Math.round((+it.value || 0) / total * 100) : 0;
      ctx.fillStyle = color(it, i); round(ctx, lx, ly + 2, 14, 14, 4); ctx.fill();
      ctx.fillStyle = T.text; ctx.font = f(15); ctx.fillText(fit(ctx, it.label, lw - 110), lx + 22, ly + 9);
      ctx.textAlign = 'right'; ctx.font = f(15, true); ctx.fillText(fmt(it.value) + (total ? '  ' + pct + '%' : ''), lx + lw, ly + 9); ctx.textAlign = 'left';
      ly += 28;
    });
  }
  function drawBars(ctx, T, b, x, y, w, h) {
    var items = b.items || [], max = b.max || items.reduce(function (a, it) { return Math.max(a, +it.value || 0); }, 0) || 1;
    var labelW = Math.min(200, w * 0.34), bx = x + 16 + labelW, bw = w - labelW - 32 - 90, by = y + 50;
    items.forEach(function (it, i) {
      ctx.fillStyle = T.text; ctx.font = f(15); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(fit(ctx, it.label, labelW - 10), x + 16, by + 12);
      ctx.fillStyle = T.grid; round(ctx, bx, by + 2, bw, 20, 10); ctx.fill();
      var vw = Math.max(0, Math.min(1, (+it.value || 0) / max)) * bw;
      if (vw > 0) { ctx.fillStyle = color(it, i); round(ctx, bx, by + 2, Math.max(vw, 6), 20, 10); ctx.fill(); }
      ctx.fillStyle = T.text; ctx.font = f(15, true); ctx.fillText(it.text != null ? String(it.text) : fmt(it.value) + (b.unit ? ' ' + b.unit : ''), bx + bw + 10, by + 12);
      by += 34;
    });
  }
  function drawColumns(ctx, T, b, x, y, w, h) {
    var items = b.items || [], n = items.length || 1, max = items.reduce(function (a, it) { return Math.max(a, +it.value || 0); }, 0) || 1;
    var left = x + 16, top = y + 52, bottom = y + h - 40, width = w - 32, gap = 8, cw = Math.max(6, (width - gap * (n - 1)) / n);
    ctx.strokeStyle = T.grid; ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) { var gy = bottom - (bottom - top) * g / 4; ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(left + width, gy); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    items.forEach(function (it, i) {
      var v = +it.value || 0, ch = (bottom - top) * v / max, cx = left + i * (cw + gap);
      ctx.fillStyle = it.color || b.color || T.accent; round(ctx, cx, bottom - ch, cw, ch, Math.min(6, cw / 2)); ctx.fill();
      ctx.fillStyle = T.text; ctx.font = f(12, true); if (v) ctx.fillText(fmt(v), cx + cw / 2, bottom - ch - 16);
      ctx.fillStyle = T.muted; ctx.font = f(n > 14 ? 10 : 12); ctx.fillText(fit(ctx, it.label, cw + gap - 2), cx + cw / 2, bottom + 6);
    });
  }
  function drawStats(ctx, T, b, x, y, w, h) {
    var items = b.items || [], n = items.length || 1, cw = (w - 16 * (n - 1)) / n;
    items.forEach(function (it, i) {
      var cx = x + i * (cw + 16);
      ctx.fillStyle = T.card; round(ctx, cx, y + 12, cw, h - 24, 12); ctx.fill();
      ctx.fillStyle = it.color || T.accent; round(ctx, cx, y + 12, 6, h - 24, 3); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = T.text; ctx.font = f(30, true); ctx.fillText(fit(ctx, it.value, cw - 30), cx + 18, y + h / 2 - 10);
      ctx.fillStyle = T.muted; ctx.font = f(13); ctx.fillText(fit(ctx, it.label + (it.sub ? ' · ' + it.sub : ''), cw - 30), cx + 18, y + h / 2 + 20);
    });
  }
  /* 清單表格：第一欄靠左，其他欄依 align（預設靠右）；斑馬紋；最後一列可加合計。 */
  function drawTable(ctx, T, b, x, y, w, h) {
    var head = b.head || [], rows = b.rows || [], n = Math.max(head.length, rows.reduce(function (a, r) { return Math.max(a, r.length); }, 0)) || 1;
    var align = b.align || [], ws = b.widths && b.widths.length === n ? b.widths : null, inner = w - 32, sum = 0, cw = [];
    for (var i = 0; i < n; i++) { cw.push(ws ? ws[i] : (i === 0 ? 2.2 : 1)); sum += cw[i]; }
    cw = cw.map(function (v) { return inner * v / sum; });
    function cell(text, ci, cy, bold, colorTxt) {
      var cx = x + 16 + cw.slice(0, ci).reduce(function (a, v) { return a + v; }, 0), a = align[ci] || (ci === 0 ? 'l' : 'r');
      ctx.font = f(15, bold); ctx.fillStyle = colorTxt || T.text; ctx.textBaseline = 'middle';
      var s2 = fit(ctx, text == null ? '' : String(text), cw[ci] - 14);
      if (a === 'r') { ctx.textAlign = 'right'; ctx.fillText(s2, cx + cw[ci] - 6, cy); }
      else if (a === 'c') { ctx.textAlign = 'center'; ctx.fillText(s2, cx + cw[ci] / 2, cy); }
      else { ctx.textAlign = 'left'; ctx.fillText(s2, cx + 6, cy); }
    }
    var cy = y + 50;
    ctx.fillStyle = T.card; round(ctx, x + 12, cy, w - 24, 30, 8); ctx.fill();
    head.forEach(function (t, ci) { cell(t, ci, cy + 15, true, T.muted); });
    cy += 34;
    rows.forEach(function (r, ri) {
      if (ri % 2) { ctx.fillStyle = T.card; ctx.fillRect(x + 12, cy, w - 24, 32); }
      r.forEach(function (t, ci) { var c = t && typeof t === 'object' ? t : { text:t }; cell(c.text, ci, cy + 16, !!c.bold || ci === 0 && !!b.boldFirst, c.color); });
      cy += 32;
    });
    if (b.total) {
      ctx.strokeStyle = T.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 12, cy + 2); ctx.lineTo(x + w - 12, cy + 2); ctx.stroke();
      b.total.forEach(function (t, ci) { cell(t, ci, cy + 20, true); });
      cy += 36;
    }
    if (b.note) { ctx.fillStyle = T.muted; ctx.font = f(13); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fit(ctx, b.note, w - 32), x + 16, cy + 14); }
  }
  /* 週檢查表：第一欄＝區域名稱，其他欄＝日期；格子用顏色表示狀態，裡面放短文字（✓ 次數／異常項目／溫度）。 */
  function drawGrid(ctx, T, b, x, y, w, h) {
    var cols = b.cols || [], rows = b.rows || [], nc = Math.max(1, cols.length);
    var two = rows.some(function (r) { return (r.cells || []).some(function (c) { return c && c.sub; }); }), rh = two ? 54 : 40;
    var labelW = Math.min(230, Math.max(150, w * 0.22)), gx = x + 16 + labelW, gw = (w - 32 - labelW) / nc, cy = y + 50;
    cols.forEach(function (c, ci) {
      var cx = gx + ci * gw + gw / 2; c = c && typeof c === 'object' ? c : { label:c };
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.text; ctx.font = f(15, true);
      ctx.fillText(fit(ctx, c.label, gw - 6), cx, cy + (c.sub ? 11 : 20));
      if (c.sub) { ctx.font = f(12); ctx.fillStyle = T.muted; ctx.fillText(fit(ctx, c.sub, gw - 6), cx, cy + 31); }
    });
    cy += 46;
    rows.forEach(function (r) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.text; ctx.font = f(15, true);
      ctx.fillText(fit(ctx, r.label, labelW - 10), x + 16, cy + rh / 2);
      for (var ci = 0; ci < nc; ci++) {
        var c = (r.cells || [])[ci] || {}, cx = gx + ci * gw + 3;
        ctx.fillStyle = c.color || T.card; round(ctx, cx, cy + 3, gw - 6, rh - 6, 8); ctx.fill();
        var dark = c.color && c.color !== T.card && !c.light;
        ctx.textAlign = 'center'; ctx.fillStyle = dark ? '#ffffff' : T.muted;
        ctx.font = f(c.sub ? 14 : 15, true);
        ctx.fillText(fit(ctx, c.text == null || c.text === '' ? '—' : String(c.text), gw - 14), cx + (gw - 6) / 2, cy + (c.sub ? rh / 2 - 9 : rh / 2));
        if (c.sub) { ctx.font = f(12); ctx.fillText(fit(ctx, c.sub, gw - 14), cx + (gw - 6) / 2, cy + rh / 2 + 11); }
      }
      cy += rh;
    });
    if ((b.legend || []).length) {
      var lx = x + 16; cy += 10; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = f(13);
      b.legend.forEach(function (it) {
        ctx.fillStyle = it.color || T.card; round(ctx, lx, cy + 3, 16, 16, 4); ctx.fill();
        ctx.fillStyle = T.muted; ctx.fillText(it.label, lx + 22, cy + 11); lx += 22 + ctx.measureText(it.label).width + 22;
      });
    }
  }
  function render(spec) {
    spec = spec || {};
    if (typeof document === 'undefined' || !document.createElement) return '';
    var T = THEMES[spec.theme] || THEMES.navy, W = spec.width || 1000, blocks = (spec.blocks || []).filter(Boolean);
    var cols = spec.columns || (blocks.length > 1 ? 2 : 1), pad = 24, gap = 16, colW = (W - pad * 2 - gap * (cols - 1)) / cols;
    /* 排版：大數字列（stats）或 span:2 的區塊自己佔一整列；其餘兩欄並排 */
    var rows = [];
    blocks.forEach(function (b) {
      var full = cols > 1 && (b.type === 'stats' || b.type === 'table' || b.type === 'grid' || b.span === 2), last = rows[rows.length - 1];
      if (full || !last || last.length >= cols || last.full) rows.push(full ? [b] : [b]);
      else last.push(b);
      if (full) rows[rows.length - 1].full = true;
    });
    var headH = 84, bodyH = rows.reduce(function (a, r) { return a + Math.max.apply(null, r.map(heightOf)) + gap; }, 0), footH = spec.footer ? 34 : 18;
    var H = headH + pad + bodyH + footH;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d'); if (!ctx) return '';
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    var gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, T.head); gr.addColorStop(1, T.head2);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, headH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = f(26, true); ctx.fillText(fit(ctx, spec.title || '', W - pad * 2), pad, spec.subtitle ? 32 : headH / 2);
    if (spec.subtitle) { ctx.font = f(15); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(fit(ctx, spec.subtitle, W - pad * 2), pad, 60); }
    var y = headH + pad;
    rows.forEach(function (r) {
      var rh = Math.max.apply(null, r.map(heightOf));
      r.forEach(function (b, ci) {
        var x = pad + ci * (colW + gap), bw = (r.full || (r.length === 1 && cols > 1 && b.span !== 1)) ? W - pad * 2 : colW;
        ctx.fillStyle = T.bg; ctx.strokeStyle = T.grid; ctx.lineWidth = 1; round(ctx, x, y, bw, rh, 14); ctx.fill(); ctx.stroke();
        if (b.title) { ctx.fillStyle = T.text; ctx.font = f(17, true); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fit(ctx, b.title, bw - 32), x + 16, y + 26); }
        try {
          if (b.type === 'donut') drawDonut(ctx, T, b, x, y, bw, rh);
          else if (b.type === 'bars') drawBars(ctx, T, b, x, y, bw, rh);
          else if (b.type === 'columns') drawColumns(ctx, T, b, x, y, bw, rh);
          else if (b.type === 'stats') drawStats(ctx, T, b, x, y, bw, rh);
          else if (b.type === 'table') drawTable(ctx, T, b, x, y, bw, rh);
          else if (b.type === 'grid') drawGrid(ctx, T, b, x, y, bw, rh);
        } catch (e) {}
      });
      y += rh + gap;
    });
    if (spec.footer) { ctx.fillStyle = T.muted; ctx.font = f(13); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fit(ctx, spec.footer, W - pad * 2), pad, H - 18); }
    try { return c.toDataURL('image/png'); } catch (e) { return ''; }
  }
  root.ACChart = { render:render, PALETTE:PALETTE, THEMES:THEMES };
})(typeof window !== 'undefined' ? window : this);
