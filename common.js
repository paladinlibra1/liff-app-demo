/**
 * ╔══════════════════════════════════════════════╗
 * ║        跨頁面共用的工具函式                    ║
 * ╚══════════════════════════════════════════════╝
 *
 * 只放「四個頁面裡一模一樣」的東西。同名但各頁行為不同的
 * （switchTab、runOnce、cancelBooking、triggerNotification…）
 * 刻意留在各自的頁面裡，不要為了消滅重複而硬湊在一起。
 *
 * 引入方式：<script src="config.js"> 之後接 <script src="common.js">
 * 依賴頁面上的全域 db / firebase（呼叫時才取用，所以載入順序不影響）。
 */

// ── 電話 ───────────────────────────────────────
// 規則：0 開頭、最多 10 碼。手機 0912345678、室內電話 0212345678 都算合法
function normalizePhone(phone) {
    return (phone || '').replace(/[\s\-()]/g, '');
}
function isValidPhone(phone) {
    return /^0\d{1,9}$/.test(normalizePhone(phone));
}
const PHONE_RULE_MSG = "電話格式不正確！\n\n請輸入 0 開頭的號碼，最多 10 碼。\n手機 0912345678、室內電話 0212345678 都可以。";

// ── 取消紀錄 ───────────────────────────────────
// 供報表計算取消率用。不影響主流程，寫入失敗不阻擋取消動作
function logCancelledBooking(bookingData, cancelledBy) {
    db.collection("cancelledBookings").add({
        date: bookingData.date || '',
        time: bookingData.time || '',
        type: bookingData.type || '',
        name: bookingData.name || '',
        phone: bookingData.phone || '',
        cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
        cancelledBy: cancelledBy
    }).catch(err => console.error("取消紀錄寫入失敗", err));
}
