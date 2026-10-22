# 智慧匯入／參考報告 — 各頁面接入指南（2026-10-22）

目標（Paul 的要求）：首頁和每一頁最上面同一顆「⇧ 智慧匯入」，msg／Excel／PDF／照片／zip 丟同一處，系統自己判斷模組（判不出來才問一次），
同檔再丟＝0 新增、已匯入的不重匯，匯完問「✈️ 發摘要」／「✅ 核可」；每一頁都能產生「參考用」Word 報告（中英或英柬，週／月／年），與 Telegram 摘要分開、不自動發。

## 已完成的共用部分（不要改）
- `shared/sec-core.js`：`SEC.importFromFiles(files, fn)`（讓既有 `SEC.pickExcel`／`SEC.pickPhoto` 不開選檔視窗、直接吃進檔案）、`SEC.registerImporter(tool, spec)`、`SEC.markPageReady()`、`SEC.registerReport` 由 sec-report 提供、頁首 `⇧`（btnHub）與「⋯ → 📝 產生報告」（btnReport）、網址 `?tg=summary|approval&ptype=month&period=2026-09` 自動開 Telegram 視窗並預選。
- `shared/sec-import-hub.js`：匯入中心（首頁內嵌、各頁彈窗）、判斷規則 `RULES_BY_TOOL`、zip／msg／eml 展開、SHA-256 已匯入記錄、背景開模組頁跑匯入、等上雲、動作按鈕。
- `shared/sec-report.js` + `shared/ac-report-doc.js` + `shared/docx.iife.js`：報告視窗與 Word 產生。
- 參考實作：`ac_sec_fire_v1.html` 最尾端（registerImporter／registerReport／markPageReady）、`tests/import-hub.cjs`。

## 每一頁要做的三件事
1. **頁面就緒**：`SEC.dataReady().then(load).then(function () { renderAll(); SEC.markPageReady(); })` — 一定要在資料載入後呼叫 `SEC.markPageReady()`，否則首頁背景匯入會一直等。
2. **登記匯入器**（同一個匯入函式，不要另寫一套）：
   ```js
   SEC.registerImporter(TOOL, { default:'excel', kinds:{
     excel:{ label:{zh:'…',en:'…',km:'…'}, accept:'excel', run:function (file) { return impExcel(); } },
     // 多種匯入就多個 kind；照片 OCR 用 accept:'photo'，run 內呼叫原本用 SEC.pickPhoto 的函式
   } });
   ```
   `run` 回傳值若是 Promise 會被等待；函式內部呼叫 `SEC.pickExcel(cb)` 時，hub 會把檔案直接餵給 cb。匯入函式若用 `prompt()` 問種類，請改成由 kind 決定（不要在 run 裡 prompt）。
3. **登記報告**：
   ```js
   SEC.registerReport(TOOL, { title:{zh,en,km}, ptypes:['week','month','year'], periods:fn(ptype)->[keys], currentPeriod:fn(ptype)->key,
     scopeOptions:fn|array（可省略）, summary:function (st) { return xxxSummaryPages(st); }  // 與 Telegram 同一套
     kpis:function (st) { return [{label:{zh,en,km}, value}] },   // 可省略；用於「期間比較」表（會自動算上期與變化）
     rows:function (st) { return { widths:[dxa…], head:[[zh,en,km]…], rows:[[…]] }; },  // 可省略；「明細」表（本期紀錄一列一筆）
     counts:function (st) { return n; },  // 可省略；趨勢表筆數（預設用 rows 長度）
     notes:[{zh,en,km}] });  // 可省略；資料依據補充
   ```
   `st = { ptype, period, lang:'zh'|'en'|'km', scope, includeDetails:false }`，與 tgOpen 傳給 summaryPages 的一樣。
4. **判斷規則**：只改 `shared/sec-import-hub.js` 裡自己模組的 `RULES_BY_TOOL.<tool>` 區塊，依該頁匯入器實際認得的表頭寫 name／sheet／head 規則；`kind` 要和登記的一致。用真實樣式的表頭寫測試。

## 測試要求
- 在 `tests/import-hub-<tool>.cjs`（Playwright，照 `tests/import-hub.cjs` 的寫法；或 jsdom）驗證：
  - 首頁丟該模組的 Excel → `HOME_HUB.items[0].tool/kind` 判對、背景匯入後資料在 IndexedDB、上雲（cloud.disk 有 smart_<tool>）、動作按鈕連到 `?tg=summary…`；
  - 同檔再丟 → `done-before`、不勾選；重匯不重複；
  - 本頁 ⇧ 直接匯入（不開 iframe）；
  - 📝 報告：`SEC.Report.open({tool})` 產生 .docx，內容含標題、摘要、明細；en 介面無中文。
- 全部 `node tests/<x>.cjs` 既有測試仍要通過（browser 類測試用 `NODE_PATH=/home/claude/.npm-global/lib/node_modules`）。
- 不可改資料邏輯、雲端同步、Telegram 發送流程；不可改 sec-core／sec-import-hub（除自己的 RULES 區塊）／sec-report。
