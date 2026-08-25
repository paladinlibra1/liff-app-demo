/**
 * 庫存同步到 Google 試算表
 * ───────────────────────────────────────────────
 * 安裝方式：
 *   1. 開啟目標試算表 → 擴充功能 → Apps Script
 *   2. 把整份檔案內容貼進 Code.gs（覆蓋原本的空白函式）
 *   3. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *      執行身分：我自己　／　具有存取權的使用者：任何人
 *   4. 複製 /exec 網址，貼進 config.js 的 inventoryGasUrl
 *   之後改程式碼要「部署 → 管理部署作業 → 編輯 → 版本：新版本」，網址才不會變。
 *
 * 輸出格式比照原本手工維護的兩張分頁：
 *   庫存：  A 系列（同系列只顯示第一列）｜B 品名｜C 會員價｜D PV
 *          ｜E~ 每個到期日批次一組「日期／數量」往右排｜最後三欄 總數量／總金額／總PV（公式）
 *   護理品：A 品名｜B 數量｜C 總數量（公式）｜D 單位｜E 工作室（保留空白，系統沒有這個欄位）｜F 備註
 *
 * 預設寫到「（自動）」分頁，不動原本手工維護的那兩張。
 * 確認格式無誤後，把下面兩個名稱改成 '庫存' / '護理品' 就會直接覆寫原分頁。
 */
var SHEET_PRODUCT = '庫存（自動）';
var SHEET_CARE = '護理品（自動）';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.action !== 'syncInventory') {
      return jsonOut({ ok: false, error: '不支援的 action：' + body.action });
    }
    var payload = body.payload || {};
    var ss = SpreadsheetApp.getActive();

    writeProductSheet(ss, payload.products || [], payload.maxBatches || 5);
    writeCareSheet(ss, payload.care || []);

    ss.getSheetByName(SHEET_PRODUCT).getRange(1, 1)
      .setNote('最後同步：' + (payload.syncedAt || new Date()) +
               (payload.lastStocktakeDate ? '\n最近盤點日：' + payload.lastStocktakeDate : ''));

    return jsonOut({ ok: true, products: (payload.products || []).length, care: (payload.care || []).length });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** 產品：每項商品一列，批次往右排成「日期／數量」成對欄位 */
function writeProductSheet(ss, products, maxBatches) {
  var pairs = Math.max(maxBatches, 5); // 至少保留 5 組，跟原本的表一致
  var header = ['', '品名', '會員價', 'PV'];
  for (var i = 0; i < pairs; i++) header.push('日期', '數量');
  header.push('總數量', '總金額', '總PV');

  var qtyCols = [];                    // 各批次「數量」欄的欄號
  for (var i = 0; i < pairs; i++) qtyCols.push(6 + i * 2);
  var totalCol = 5 + pairs * 2;        // 總數量
  var priceCol = 3, pvCol = 4;

  var rows = [];
  var lastSeries = null;
  products.forEach(function (p, idx) {
    var r = idx + 2;                   // 實際列號（第 1 列是標題）
    var row = [p.series === lastSeries ? '' : p.series, p.name, p.memberPrice, p.pv];
    lastSeries = p.series;
    for (var i = 0; i < pairs; i++) {
      var b = (p.batches || [])[i];
      row.push(b && b.expiryDate ? new Date(b.expiryDate) : '', b ? b.qty : '');
    }
    var sumRefs = qtyCols.map(function (c) { return colLetter(c) + r; }).join(',');
    row.push('=SUM(' + sumRefs + ')');
    row.push('=' + colLetter(totalCol) + r + '*' + colLetter(priceCol) + r);
    row.push('=' + colLetter(totalCol) + r + '*' + colLetter(pvCol) + r);
    rows.push(row);
  });

  var sheet = resetSheet(ss, SHEET_PRODUCT, header);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    // 日期欄統一格式，避免顯示成序號
    for (var i = 0; i < pairs; i++) {
      sheet.getRange(2, 5 + i * 2, rows.length, 1).setNumberFormat('yyyy/mm/dd');
    }
  }
  sheet.autoResizeColumns(1, header.length);
}

/** 護理品：品名／數量／總數量（公式）／單位／工作室（留白）／備註 */
function writeCareSheet(ss, care) {
  var header = ['品名', '數量', '總數量', '單位', '工作室', '備註'];
  var rows = care.map(function (c, idx) {
    var r = idx + 2;
    return [c.name, c.qty, '=B' + r, c.unit, '', c.note];
  });
  var sheet = resetSheet(ss, SHEET_CARE, header);
  if (rows.length) sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
  sheet.autoResizeColumns(1, header.length);
}

function resetSheet(ss, name, header) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clear();
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/** 1 → A、27 → AA */
function colLetter(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = (col - m - 1) / 26;
  }
  return s;
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
