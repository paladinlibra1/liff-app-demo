/**
 * Google 日曆同步的修復與補件。
 * 這個檔案只是「給人複製貼上」的參考，不會被部署；
 * 真正在跑的是使用者 Apps Script 專案裡的那份程式碼。
 */

// =========================================================
// 改動 1：handleNotification 裡的日曆刪除邏輯
// ---------------------------------------------------------
// 原本：
//   const events = calendar.getEvents(前90天, 後90天, {search: resID});
//   events.forEach(ev => ev.deleteEvent());
//
// 問題：完全信任 search 只會撈回自己那一筆。一旦撈回別人的事件，
//       forEach(deleteEvent) 不會多問一句就全刪。實際結果是每來一筆
//       新預約就把前後 90 天的日曆洗空，只重畫自己那一筆。
//
// 改成：刪之前再確認事件備註裡真的寫著這筆的系統 ID。
// =========================================================
/*
    const events = calendar.getEvents(
      new Date(now.getTime() - 90*24*60*60*1000),
      new Date(now.getTime() + 90*24*60*60*1000),
      {search: resID}
    ).filter(ev => (ev.getDescription() || "").indexOf("系統ID：" + resID) !== -1);

    // resID 是 "無ID" 時無法辨識是哪一筆，寧可不刪也不要誤刪別人的
    if (resID !== "無ID") { events.forEach(ev => ev.deleteEvent()); }
*/

// =========================================================
// 改動 2：貼到 Apps Script 最後面，手動執行一次即可
//   從 Firestore 把「今天以後」的預約補回日曆。
//   已經存在（備註有同一組系統ID）的會略過，不會重複建立，
//   所以先從垃圾桶還原、再執行這支，也不會變兩份。
//   全程不發任何 LINE 訊息。
// =========================================================
function rebuildCalendarFromFirestore() {
  var PROJECT_ID = "colorfashion-booking";
  var API_KEY = "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU";
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  var todayStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  Logger.log("🛠 開始補件，補 " + todayStr + " 以後的預約");

  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
            "/databases/(default)/documents/bookings?pageSize=1000&key=" + API_KEY;
  var result = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  if (!result.documents) { Logger.log("🤷 bookings 沒有資料，結束。"); return; }

  var created = 0, skipped = 0;

  for (var i = 0; i < result.documents.length; i++) {
    var doc = result.documents[i];
    var f = doc.fields || {};
    var get = function (k) { return (f[k] && f[k].stringValue) ? f[k].stringValue : ""; };

    var date = get("date");
    if (!date || date < todayStr) continue;                      // 只補未來的
    if (get("status") && get("status") !== "active") continue;   // 已取消的不補

    var resID = doc.name.split("/").pop();
    var dayStart = new Date(date + "T00:00:00");
    var dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // 當天已經有同一組系統ID的事件就略過
    var already = false;
    var sameDay = calendar.getEvents(dayStart, dayEnd);
    for (var j = 0; j < sameDay.length; j++) {
      if ((sameDay[j].getDescription() || "").indexOf("系統ID：" + resID) !== -1) { already = true; break; }
    }
    if (already) { skipped++; continue; }

    var name = get("name"), name2 = get("name2"), time = get("time"), type = get("type");
    var combinedName = name + (name2 ? " & " + name2 : "");
    var remarkText = get("remark") || "無";
    var startTime = new Date(date + "T" + time + ":00");
    var endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    // 備註格式必須跟 handleNotification 完全一致，之後同步才找得到這筆
    var descriptionText = "日期：" + date + "\n時間：" + time + "\n身分：" + type +
      "\n電話：" + (get("phone") || "無") + "\n同行：" + (name2 || "無") +
      "\n客需備註：" + remarkText + "\n系統ID：" + resID;

    var ev = calendar.createEvent(combinedName, startTime, endTime, { description: descriptionText });
    if (type === "新客體驗") { ev.setColor(CalendarApp.EventColor.YELLOW); }
    else if (type === "一般預約") { ev.setColor(CalendarApp.EventColor.GREEN); }
    else if (type === "複檢") { ev.setColor(CalendarApp.EventColor.CYAN); }
    else { ev.setColor(CalendarApp.EventColor.RED); }

    Logger.log("✅ 補上 " + date + " " + time + " " + combinedName);
    created++;
    Utilities.sleep(200);   // 避免觸發日曆 API 速率限制
  }

  Logger.log("🏁 補件完畢：新增 " + created + " 筆，略過（已存在）" + skipped + " 筆");
}

// =========================================================
// 唯讀比對：Firestore 的未來預約 vs Google 日曆
//   只印報告，不新增也不刪除。手動從垃圾桶還原後用這支驗收。
// =========================================================
function checkCalendarVsFirestore() {
  var PROJECT_ID = "colorfashion-booking";
  var API_KEY = "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU";
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  var todayStr = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");

  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID +
            "/databases/(default)/documents/bookings?pageSize=1000&key=" + API_KEY;
  var result = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  if (!result.documents) { Logger.log("bookings 沒有資料"); return; }

  var rows = [];
  for (var i = 0; i < result.documents.length; i++) {
    var f = result.documents[i].fields || {};
    var g = function (k) { return (f[k] && f[k].stringValue) ? f[k].stringValue : ""; };
    if (!g("date") || g("date") < todayStr) continue;
    if (g("status") && g("status") !== "active") continue;
    rows.push({ id: result.documents[i].name.split("/").pop(), date: g("date"),
                time: g("time"), name: g("name") + (g("name2") ? " & " + g("name2") : "") });
  }
  rows.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });

  var missing = 0, dup = 0, wrongTime = 0;
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k];
    var dayStart = new Date(r.date + "T00:00:00");
    var hits = calendar.getEvents(dayStart, new Date(dayStart.getTime() + 86400000))
      .filter(function (ev) { return (ev.getDescription() || "").indexOf("系統ID：" + r.id) !== -1; });

    if (hits.length === 0) { Logger.log("❌ 缺少   " + r.date + " " + r.time + " " + r.name); missing++; }
    else if (hits.length > 1) { Logger.log("⚠️ 重複x" + hits.length + " " + r.date + " " + r.time + " " + r.name); dup++; }
    else {
      var t = Utilities.formatDate(hits[0].getStartTime(), "Asia/Taipei", "HH:mm");
      if (t !== r.time) { Logger.log("⏰ 時間不符 " + r.date + " 日曆" + t + " / 系統" + r.time + " " + r.name); wrongTime++; }
      else { Logger.log("✅ 正常   " + r.date + " " + r.time + " " + r.name); }
    }
  }
  Logger.log("🏁 共 " + rows.length + " 筆：缺少 " + missing + "，重複 " + dup + "，時間不符 " + wrongTime);
}
