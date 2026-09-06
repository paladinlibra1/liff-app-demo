/**
 * Colorfashion 預約系統 - 極簡後端 API (Firebase 專用對接版)
 * 負責：LINE 推播通知、Google 日曆同步、系統錯誤紀錄、每日定時提醒
 */

// ---------------- 設定區 ----------------
// 機密不寫在程式碼裡，值存在「專案設定 → 指令碼屬性」，跟著專案走、不進 git
const _P = PropertiesService.getScriptProperties();
const CALENDAR_ID = _P.getProperty("CALENDAR_ID");
const CHANNEL_ACCESS_TOKEN = _P.getProperty("CHANNEL_ACCESS_TOKEN");
const SHEET_ID = _P.getProperty("SHEET_ID");
const GROUP_ID = _P.getProperty("GROUP_ID") || "";
//const FRONTEND_URL = "https://paladinlibra1.github.io/liff-app-demo/index.html"; 
const FRONTEND_URL = "https://liff.line.me/2009018559-AeGOURPY";

// ---------------- 核心路由 (只保留兩個功能) ----------------
function doPost(e) {
  try {
    var request = JSON.parse(e.postData.contents);
    var action = request.action;
    var payload = request.payload;

    if (action === "sendNotification") {
      // 攔截 Firebase 傳來的新增/修改/取消訊號
      return handleNotification(payload);
    } else if (action === "logError") {
      // 保留前端錯誤紀錄功能
      return logError(payload);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "未知的動作" })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) { return ContentService.createTextOutput("Backend API is running on Minimalist Mode..."); }

// =========================================================
// 🔔 核心 1：處理通知排版、發送 LINE 與 同步 Google 日曆
// =========================================================
function handleNotification(payload) {
  var data = payload.data;
  var type = payload.type; // 接收 'new', 'update', 'cancel'

  var isAdminBooking = (data.role === 'admin');
  var actionText = "";
  var customerHeaderColor = "";
  var adminHeaderColor = "";
  var titlePrefix = "";

  if (type === 'new') {
    actionText = "🆕 新增預約";
    customerHeaderColor = "#d68095"; // 粉色
    adminHeaderColor = "#9C27B0";    // 紫色
    titlePrefix = "🎉 預約成功";
  } else if (type === 'update') {
    actionText = "🔄 修改預約";
    customerHeaderColor = "#d68095"; 
    adminHeaderColor = "#9C27B0";    
    titlePrefix = "🔄 預約修改";
  } else if (type === 'cancel') {
    actionText = "❌ 取消預約";
    customerHeaderColor = "#e57373"; // 紅色
    adminHeaderColor = "#e57373";    
    titlePrefix = "🗑️ 預約已取消";
  } else if (type === 'dormant_reengage') {
    if (data.lineId && data.message) {
      sendLinePush(data.lineId, data.message);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  }

  var combinedName = data.name + (data.name2 && data.name2 !== "" ? " & " + data.name2 : "");
  var remarkText = (data.remark && data.remark !== "") ? data.remark : "無";
  var resID = data.id || "無ID";
  var editLink = FRONTEND_URL + "?id=" + resID;

  // ---------------------------------------------------------
  // 📅 同步寫入 Google 日曆 (極簡標題版)
  // ---------------------------------------------------------
  try {
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const now = new Date();
    // 擴大搜尋範圍，確保能抓到舊事件並刪除 (避免修改或取消時殘留)
    //const events = calendar.getEvents(new Date(now.getTime() - 90*24*60*60*1000), new Date(now.getTime() + 90*24*60*60*1000), {search: resID});
    //events.forEach(ev => ev.deleteEvent());

    const events = calendar.getEvents(
      new Date(now.getTime() - 90*24*60*60*1000),
      new Date(now.getTime() + 90*24*60*60*1000),
      {search: resID}
    ).filter(ev => (ev.getDescription() || "").indexOf("系統ID：" + resID) !== -1);

    // resID 是 "無ID" 時無法辨識是哪一筆，寧可不刪也不要誤刪別人的
    if (resID !== "無ID") { events.forEach(ev => ev.deleteEvent()); }

    // 如果不是取消單，就重新畫上日曆
    if (type !== 'cancel') {
      const startTime = new Date(data.date + "T" + data.time + ":00");
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); 
      
      // 日曆備註詳細資訊
      let descriptionText = "日期：" + data.date + "\n時間：" + data.time + "\n身分：" + data.type + "\n電話：" + (data.phone || "無") + "\n同行：" + (data.name2 || "無") + "\n客需備註：" + remarkText + "\n系統ID：" + resID;
      
      // 標題只顯示人名
      let newEvent = calendar.createEvent(combinedName, startTime, endTime, {description: descriptionText});

      if (data.type === "新客體驗") { newEvent.setColor(CalendarApp.EventColor.YELLOW); } 
      else if (data.type === "一般預約") { newEvent.setColor(CalendarApp.EventColor.GREEN); } 
      else if (data.type === "複檢") { newEvent.setColor(CalendarApp.EventColor.CYAN); } 
      else { newEvent.setColor(CalendarApp.EventColor.RED); }
    }
  } catch(e) {
    Logger.log("日曆同步失敗：" + e);
  }

  // ---------------------------------------------------------
  // 💌 傳送 LINE 給客人
  // ---------------------------------------------------------
  if (data.lineId && data.lineId !== "") {
    var title = titlePrefix + "通知";
    var greeting = "👋 " + combinedName + " 您好\n";
    if (type === 'cancel') { greeting += "您的預約已「取消」。期待下次為您服務！"; } 
    else { greeting += "您的預約已" + ((type==='new')?"保留":"更新") + "，詳細資訊如下：\n(備註: " + remarkText + ")"; }

    var customerFlexMsg = getFlexMessage(title, greeting, { date: data.date, time: data.time, link: editLink }, { color: customerHeaderColor, showAttendBtn: false, isCancel: (type === 'cancel') });
    sendLinePush(data.lineId, customerFlexMsg);
  }

  // ---------------------------------------------------------
  // 🏪 傳送 LINE 給店家群組
  // ---------------------------------------------------------
  if (typeof GROUP_ID !== 'undefined' && GROUP_ID !== "") {
    var adminTitle = "";
    if (type === 'new') adminTitle = isAdminBooking ? "🆕 新增預約 (店家代訂)" : "📲 新增預約 (客人自訂)";
    else if (type === 'update') adminTitle = "🔄 預約已由客人修改";
    else if (type === 'cancel') adminTitle = "❌ 預約已被取消";
    
    // 🔥 新增：去 Firebase 反查 LINE 暱稱 (解決代訂沒暱稱的問題)
    var fetchedLineName = data.lineName || "";
    if (!fetchedLineName || fetchedLineName.trim() === "") {
        var API_KEY = "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU"; 
        var PROJECT_ID = "colorfashion-booking";
        try {
            // 1. 嘗試用 lineId 去 members 資料庫找
            if (data.lineId) {
                var url1 = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/members/" + data.lineId + "?key=" + API_KEY;
                var res1 = UrlFetchApp.fetch(url1, {muteHttpExceptions: true});
                if (res1.getResponseCode() === 200) {
                    var doc = JSON.parse(res1.getContentText());
                    if (doc.fields && doc.fields.lineName) fetchedLineName = doc.fields.lineName.stringValue;
                }
            }
            // 2. 如果沒有 lineId，就直接用「電話號碼」去搜尋
            if ((!fetchedLineName || fetchedLineName.trim() === "") && data.phone) {
                var url2 = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents:runQuery?key=" + API_KEY;
                var payload2 = {
                    "structuredQuery": {
                        "from": [{"collectionId": "members"}],
                        "where": { "fieldFilter": { "field": {"fieldPath": "phone"}, "op": "EQUAL", "value": {"stringValue": data.phone} } },
                        "limit": 1
                    }
                };
                var res2 = UrlFetchApp.fetch(url2, { method: "post", contentType: "application/json", payload: JSON.stringify(payload2), muteHttpExceptions: true });
                if (res2.getResponseCode() === 200) {
                    var qData = JSON.parse(res2.getContentText());
                    if (qData.length > 0 && qData[0].document && qData[0].document.fields && qData[0].document.fields.lineName) {
                        fetchedLineName = qData[0].document.fields.lineName.stringValue;
                    }
                }
            }
        } catch(e) { Logger.log("查詢暱稱失敗：" + e); }
    }
    
    // 🔥 組合老闆專屬的姓名顯示 (姓名 + 括號的暱稱)
    var adminCombinedName = combinedName;
    if (data.lineName && String(data.lineName).trim() !== "") {
        adminCombinedName += " (" + String(data.lineName).trim() + ")";
    }

    var adminGreeting = "有一筆預約" + ((type==='new')?"新增":(type==='update'?"修改":"取消")) + "：\n(" + adminCombinedName + " - " + data.type + ")\n電話：" + data.phone + "\n備註：" + remarkText;
    // var adminGreeting = "有一筆預約" + ((type==='new')?"新增":(type==='update'?"修改":"取消")) + "：\n(" + combinedName + " - " + data.type + ")\n電話：" + data.phone + "\n備註：" + remarkText;
    var adminFlexMsg = getFlexMessage(adminTitle, adminGreeting, { date: data.date, time: data.time, link: editLink }, { color: adminHeaderColor, showAttendBtn: false, isCancel: (type === 'cancel') });

    if (type !== 'cancel') {
        var shareLabel = isAdminBooking ? "📤 轉傳確認單給客人" : "💬 傳送確認訊息給客人";
        adminFlexMsg.contents.footer = {
            "type": "box", "layout": "vertical", "paddingAll": "20px",
            "contents": [
              { "type": "button", "style": "primary", "color": "#00B900", "action": { "type": "uri", "label": shareLabel, "uri": "https://line.me/R/msg/text/?" + encodeURIComponent("👋 您好 " + combinedName + "，這是您的預約確認單，請點擊連結確認：\n" + editLink) } },
              { "type": "button", "style": "secondary", "margin": "md", "action": { "type": "uri", "label": "🛠 店家管理此單", "uri": editLink } }
            ]
        };
    } else { delete adminFlexMsg.contents.footer; }

    sendLinePush(GROUP_ID, adminFlexMsg);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
}

// =========================================================
// 🎨 核心 2：萬用 Flex Message 卡片產生器
// =========================================================
function getFlexMessage(title, greeting, data, config) {
  const HEADER_COLOR = config.color || "#d68095"; 
  let footerButtons = [];

  if (config.showAttendBtn) {
    footerButtons.push({ "type": "button", "style": "primary", "height": "sm", "color": "#4CAF50", "action": { "type": "message", "label": "✅ 我會如期前往", "text": "✅ 我會如期前往" } });
  }

  if (!config.isCancel) {
      footerButtons.push({ "type": "button", "style": "link", "height": "sm", "color": "#666666", "margin": config.showAttendBtn ? "md" : "none", "action": { "type": "uri", "label": "❌ 更改或取消預約", "uri": data.link } });
  }

  let flexObj = {
    "type": "flex", "altText": `${title}：${data.date} ${data.time}`,
    "contents": {
      "type": "bubble", "size": "mega",
      "header": { "type": "box", "layout": "vertical", "backgroundColor": HEADER_COLOR, "paddingAll": "15px", "contents": [ { "type": "text", "text": title, "color": "#ffffff", "weight": "bold", "size": "lg", "align": "center" } ] },
      "body": { "type": "box", "layout": "vertical", "contents": [
          { "type": "text", "text": greeting, "wrap": true, "color": "#555555", "size": "md", "align": "center" },
          { "type": "separator", "margin": "lg" },
          { "type": "text", "text": data.date, "weight": "bold", "size": "xl", "margin": "lg", "align": "center", "color": HEADER_COLOR },
          { "type": "text", "text": data.time, "weight": "bold", "size": "3xl", "margin": "sm", "align": "center", "color": "#333333" },
          { "type": "separator", "margin": "lg" },
          { "type": "text", "text": config.isCancel ? "本預約已失效" : "👇 請點擊下方按鈕進行操作 👇", "size": "xs", "color": "#aaaaaa", "align": "center", "margin": "lg" }
      ]}
    }
  };
  if (footerButtons.length > 0) { flexObj.contents.footer = { "type": "box", "layout": "vertical", "contents": footerButtons, "paddingAll": "20px" }; }
  return flexObj;
}

// =========================================================
// 🚀 核心 3：LINE 推播發送器
// =========================================================
function sendLinePush(to, messageContent) {
  try {
    let messages = (typeof messageContent === 'string') ? [{ "type": "text", "text": messageContent }] : [messageContent];
    UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      "method": "post",
      "headers": { "Authorization": "Bearer " + CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json" },
      "payload": JSON.stringify({ "to": to, "messages": messages }),
      "muteHttpExceptions": true 
    });
  } catch (e) { Logger.log("Push Error: " + e.toString()); }
}

// =========================================================
// 📝 核心 4：保留寫入試算表的錯誤紀錄功能
// =========================================================
function logError(payload) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID); 
    var sheet = ss.getSheetByName("系統錯誤紀錄");
    if (!sheet) {
      sheet = ss.insertSheet("系統錯誤紀錄");
      sheet.appendRow(["發生時間", "使用者", "錯誤訊息", "錯誤情境", "裝置資訊"]);
    }
    sheet.appendRow([ payload.time, payload.user, payload.message, payload.context, payload.userAgent ]);
    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// =========================================================
// ⏰ 核心 5：Firebase 版每日自動提醒排程 (內建追蹤雷達)
// =========================================================
function sendDailyRemindersFirebase() {
  Logger.log("⏰ 鬧鐘啟動：開始檢查 Firebase 預約單...");

  var PROJECT_ID = "colorfashion-booking";
  var API_KEY = "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU"; 
  // 🔥 升級 1：加上 pageSize=1000，確保單量變多時不會被截斷沒抓到！
  var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/bookings?pageSize=1000&key=" + API_KEY;
  
  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var result = JSON.parse(response.getContentText());
    
    if (!result.documents) {
        Logger.log("🤷‍♂️ 目前 Firebase 裡面沒有預約單，直接下班！"); 
        return;
    }
    
    Logger.log("📂 抓到資料了！總共有 " + result.documents.length + " 筆單"); 
    
    var today = new Date(); 
    var tomorrow = new Date(today); 
    tomorrow.setDate(today.getDate() + 1);
    // 🔥 升級 2：強制指定 "Asia/Taipei"，防止 Google 主機用美國時間算錯明天！
    var tomorrowStr = Utilities.formatDate(tomorrow, "Asia/Taipei", "yyyy-MM-dd");
    Logger.log("🎯 系統認知的明天日期是：" + tomorrowStr);
    
    var remindCount = 0;

    for (var i = 0; i < result.documents.length; i++) {
      var doc = result.documents[i]; var fields = doc.fields;
      if (!fields) continue;
      
      var date = fields.date ? fields.date.stringValue : "";
      var lineId = fields.lineId ? fields.lineId.stringValue : "";
      var isReminded = fields.isReminded ? fields.isReminded.booleanValue : false;
      var name = fields.name ? fields.name.stringValue : "貴賓";
      
      // 🔥 升級 3：雷達偵測！只要日期是明天的單，全部印出來看問題出在哪！
      if (date === tomorrowStr) {
          Logger.log(`🔍 找到明天的單 [${name}] ➔ LINE綁定: ${lineId ? "有" : "無(空白)"} | 是否已提醒過: ${isReminded}`);
      }
      
      if (date === tomorrowStr && lineId && !isReminded) {
        var time = fields.time ? fields.time.stringValue : "";
        var name2Text = (fields.name2 && fields.name2.stringValue && fields.name2.stringValue.trim() !== "") ? fields.name2.stringValue : "無";
        var remarkText = (fields.remark && fields.remark.stringValue && fields.remark.stringValue.trim() !== "") ? fields.remark.stringValue : "無";
        
        var pathParts = doc.name.split("/"); var docId = pathParts[pathParts.length - 1];
        
        var title = "📅 明日預約提醒";
        var greeting = "👋 " + name + " 您好\n提醒您，明天有預約，期待您的光臨！\n\n【同行】" + name2Text + "\n【備註】" + remarkText;
        
        var flexMsg = getFlexMessage(title, greeting, { date: date + " (明天)", time: time, link: FRONTEND_URL + "?id=" + docId }, { color: "#5DADE2", showAttendBtn: true, isCancel: false });
        sendLinePush(lineId, flexMsg);
        
        Logger.log("✅ 成功發送明日提醒給：" + name);
        remindCount++;

        // 標記已提醒
        UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + doc.name + "?updateMask.fieldPaths=isReminded&key=" + API_KEY, {
          "method": "patch", "contentType": "application/json", "payload": JSON.stringify({"fields": {"isReminded": { "booleanValue": true }}}), "muteHttpExceptions": true
        });
      }
    }
    Logger.log("🏁 檢查完畢！本次總共發送了 " + remindCount + " 筆提醒。");

  } catch (e) { Logger.log("提醒發送失敗：" + e.toString()); }
}

// =========================================================
// 🗄️ 核心 6：定時封存過期預約到 historicalBookings
// =========================================================
function archiveOldBookings() {
  Logger.log("🗄️ 封存程序啟動：開始搬移過期預約...");

  var PROJECT_ID = "colorfashion-booking";
  var API_KEY = "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU";
  var BASE_URL = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";

  // 取得今天日期字串（台北時間）
  var today = new Date();
  var todayStr = Utilities.formatDate(today, "Asia/Taipei", "yyyy-MM-dd");
  Logger.log("📅 今天日期：" + todayStr + "，封存早於此日期的預約");

  try {
    // 1. 抓取所有 bookings
    var url = BASE_URL + "/bookings?pageSize=1000&key=" + API_KEY;
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var result = JSON.parse(response.getContentText());

    if (!result.documents) {
      Logger.log("🤷 bookings 裡沒有任何資料，結束。");
      return;
    }

    Logger.log("📂 共抓到 " + result.documents.length + " 筆預約");

    var archiveCount = 0;
    var errorCount = 0;

    for (var i = 0; i < result.documents.length; i++) {
      var doc = result.documents[i];
      var fields = doc.fields;
      if (!fields) continue;

      var date = fields.date ? fields.date.stringValue : "";
      if (!date || date >= todayStr) continue; // 今天或未來的不封存

      // 取得文件 ID
      var pathParts = doc.name.split("/");
      var docId = pathParts[pathParts.length - 1];

      try {
        // 2. 複製到 historicalBookings
        var writeUrl = BASE_URL + "/historicalBookings/" + docId + "?key=" + API_KEY;
        UrlFetchApp.fetch(writeUrl, {
          method: "patch",
          contentType: "application/json",
          payload: JSON.stringify({ fields: fields }),
          muteHttpExceptions: true
        });

        // 3. 從 bookings 刪除
        var deleteUrl = BASE_URL + "/bookings/" + docId + "?key=" + API_KEY;
        UrlFetchApp.fetch(deleteUrl, {
          method: "delete",
          muteHttpExceptions: true
        });

        Logger.log("✅ 封存完成：" + (fields.name ? fields.name.stringValue : docId) + " (" + date + ")");
        archiveCount++;

        // 避免 API 速率限制
        Utilities.sleep(200);

      } catch (e) {
        Logger.log("❌ 封存失敗 [" + docId + "]：" + e.toString());
        errorCount++;
      }
    }

    Logger.log("🏁 封存完畢！成功 " + archiveCount + " 筆，失敗 " + errorCount + " 筆。");

  } catch (e) {
    Logger.log("封存程序發生錯誤：" + e.toString());
  }
}

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
