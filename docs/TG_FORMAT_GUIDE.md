# Telegram 群組摘要格式指南（2026-10-02）

Owner (Paul) complaint: group summaries are hard to read — tables never line up, in/out times are hard to read, attendance runs to many pages, fire/CCTV lists are dense. He wants: **understood at a glance, nothing misaligned, intuitive**.

## Why the old format breaks
Old builders pad columns with spaces (`xxxCell(v,n)`) and wrap them in `<blockquote>`. Telegram renders blockquote in a *proportional* font, so the padding never aligns, and long rows wrap on phones. **Never use space-padded tables again.**

## Rules
1. **Header**: `SEC.TG.head(icon, title, periodLabel, optionalSubLine)` → icon + bold title, `📅 period`, divider.
2. **Verdict first**: the line right under the header is `SEC.TG.verdict(level, text)` — e.g. `🟢 一切正常` / `🟠 3 項需注意` / `🔴 2 項異常` — followed by right after the header, the key numbers via `SEC.TG.kpis([[icon,label,value],...], 2 or 3 per line)`, then a warning line if anything needs attention (`⚠️ … <b>n</b>`), or `✅ 全部正常` style line when all good.
3. **Exceptions before normal**: list only abnormal / overdue / missing / short items by default. Normal items are counts only. Full lists only when `st.includeDetails` is ticked.
4. **One record = one line** (max 2–4 short lines for rich records). Start list lines with `• `. Identity first and bold (`<b>FE35</b>`, `<b>3D-1344</b>`, `<b>Name</b>`), then ` · ` separated facts. Times as `HH:MM` via `SEC.TG.time()`; dates as `MM-DD` via `SEC.TG.d()`; consecutive dates compressed via `SEC.TG.ranges(dates)` (e.g. `09-01~05, 09-08`).
5. **Group by date** instead of repeating the date on every line: `📅 <b>09-18</b> · 4` then the lines.
6. **Sections**: `SEC.TG.sec(icon, title)` (adds blank line + bold title).
7. **Long lists**: either page them (each page text ≤ ~3000 chars, use `SEC.TG.chunk(title, lines, 3000)` or your own loop) or fold with `SEC.TG.fold(lines)` (Telegram expandable quote — tap to expand). Prefer fewer pages: a monthly report without details should normally be **1 page**.
8. **Languages**: every word label goes through `SEC.TG.lbl(lang, zh, en, km)` (NOT tl/L directly) so the "繁中 + English" mode can merge the zh and en versions line-by-line into `中/英` labels without duplicating numbers and names. Requirements for that merge to work:
   - zh and en versions of a page must have **the same number of lines in the same order** (same conditions, no language-dependent line breaks).
   - Data (names, codes, plates, numbers, times, remarks) must be identical between languages; only `lbl(...)` segments may differ.
   - A translated value that is not a fixed literal (e.g. a status text or category from a helper) can be wrapped as `SEC.TG.lbl('zh', alreadyTranslatedText)` so it is treated as a label.
   - en and km output must contain **no Chinese** (existing tests check this).
9. **Photos** stay attached to the page that lists their record, max 4 per page; never attach photos of normal items in monthly reports (keep existing photo rules and tests).
10. Do not add a footer such as "AC Security · VRT Sihanoukville" or "tick details for more" — the backend already appends `AC Security Platform · time`, and sender hints belong in the web modal, not in the group.
11. Keep each message short enough to read on a phone without scrolling much: target ≤ 25 lines for the first page.

## Helper API (shared/sec-core.js, exported as `SEC.TG`)
| fn | does |
|---|---|
| `lbl(lang, zh, en, km)` | language label with merge markers (stripped before sending) |
| `head(icon, title, period, sub)` | header + divider |
| `kpis(items, perLine)` | `icon label <b>value</b>` joined by `  ·  ` |
| `sec(icon, title)` | section title |
| `fold(lines)` | `<blockquote expandable>` block |
| `chunk(title, lines, budget)` | split lines into pages ≤ budget chars |
| `d(date)` / `time(t)` / `mins(t)` / `dur(minutes)` / `ranges(dates)` | formatting |
| `verdict(level, text)` | status light line (`🟢/🟠/🔴 <b>text</b>`), level `ok`/`warn`/`bad`; put it right under the header |
| `bar(value, total, width=10)` | colour progress bar `🟩🟩🟩⬜ 92%` (green ≥90%, yellow ≥70%, red below) for the one key ratio of the message |

Reference implementation: `ac_sec_commute_v2.html` → `commuteSummary`, `commuteSummaryPageDefs`, `commuteGateLines`.

## Preview tool
`node tools/tg-preview.cjs <page.html> <fixture.js> <openerFn> <day|week|month|year> <period> <scope> <0|1 details> <langs>` opens the real Telegram modal in jsdom and prints the exact preview text (both-mode merge included). Write a fixture file that assigns the page's global arrays with realistic data, then call the render function if needed.

## Do not change
- Data logic, storage, cloud sync, add/edit/delete/save, import/export, approval flow.
- Function names used by tgOpen (`xxxSummaryPages`, `xxxSummaryPhotos`, `xxxPageDefs`, etc.) and their return shapes.
- `shared/sec-core.js`, `shared/sec.css`, `ac_sec.gs` (owned by the lead).

## Tests
All of `tests/*.cjs` must pass (`node tests/<file>.cjs`; browser.cjs uses Playwright Chromium at /opt/pw-browsers). If a test asserts the *old table text* (e.g. a header string like `'ID        Name'`), update it to assert the same **meaning** in the new format (same records present, same counts, photos with their rows, no Chinese in en/km, ≤ 3800 chars per page). Never weaken a data-integrity, photo or translation assertion.

## 2026-11-12／13 補充（Paul：列表、顏色、圖表要一致，數字要正確、欄位要對齊）
- **欄位位置固定**：同一種清單每一行的欄位順序都一樣，沒填的顯示 `—`（不要省略），這樣同一個位置就是同一種資料。
- **時間放最前面**，用 `<code>` 包起來（等寬）：`<code>09-30 08:30→09:41</code>`；沒有時間寫 `--:--`。
- **顏色／燈號放行首**：上午 🟡／下午 🔵（出入閘、貨櫃）；夜班 🌙／日班 ☀️（巡邏）；A 廠 🟦／B 廠 🟧；狀態 🟢／🟠／🔴。
- **圖示當欄位名稱**：👮 人、📍 地點、🚚 車牌、🏢 公司／部門、📝 備註、📷 照片、🔍 檢查人、⚖️ 重量。
- **數字核對行**：重點數字後面加一行「✅ 總數＝A＋B＋C · 已核對正確」；要用另一條路徑重新數一次再比（不要拿相減出來的數字自己比自己），不符就亮 ⚠️ 並列出兩邊數字。
- **不可以用空白補齊**（tests/tg-format.cjs 會擋連續 3 個空白）。要對齊就把固定寬度的東西（色條、燈號、時間）放前面。
- 出勤率顏色照 Paul 的考勤標準：92% 以上綠、88–92% 黃、88% 以下紅。
- 已照這套改完：通勤、貨櫃、巡邏、CCTV、出勤、人員異動、費用、消防。
- 手機精簡清單（shared/sec-compact.js）：消防設備、保安名冊、CCTV、貨櫃（進出／檢查／單據）、通勤（派車／出入閘／遲到）。`keep` 可把「➕ 新增」留在篩選列。
  費用清單**不要掛**：清單的勾選框是送核可用的，精簡清單會把它藏起來。巡邏逐圈、出勤表是矩陣不是清單，也不掛。
