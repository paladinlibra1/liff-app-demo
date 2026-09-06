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
// 規則：09 開頭一律 10 碼（手機）；其他 0 開頭視為市話，含區碼共 9 或 10 碼。
// 台灣市話最短 9 碼（06-2345678、08-7654321），最長 10 碼（02-12345678、0800-123456）。
// 舊規則只要求「0 開頭、2 到 10 碼」，手機少打一碼也照樣通過。
function normalizePhone(phone) {
    return (phone || '')
        // 全形數字轉半形：從通訊錄或訊息貼過來常常是全形
        .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
        // 空白、各式連字號、點、全形括號一律當分隔符號清掉
        .replace(/[\s\-‐‑‒–—−ー.．()（）]/g, '')
        // 國際碼寫法轉回本地：+886912345678 → 0912345678
        .replace(/^\+?886/, '0');
}
function isValidPhone(phone) {
    const p = normalizePhone(phone);
    if (!/^0\d+$/.test(p)) return false;
    if (p.startsWith('09')) return p.length === 10;
    return p.length === 9 || p.length === 10;
}
const PHONE_RULE_MSG = "電話格式不正確！\n\n手機請輸入 09 開頭的 10 碼號碼（例如 0912345678）。\n市話請含區碼，共 9 或 10 碼（例如 062345678、0212345678）。";

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

// ── 後台登入閘門 ───────────────────────────────
// admin.html / inventory.html 共用。頁面需求：
//   1. <script src="...firebase-auth-compat.js"> 2. <body class="auth-locked">
//   3. 建好 db 之後呼叫 initAuthGate()
// 要加人／移除人，改下面這個陣列就好（大小寫不拘），兩個頁面同時生效
const ADMIN_EMAILS = [
    "store@colorfashion.local",     // 店裡共用的備援帳號（密碼登入）
    "paladinlibra1@gmail.com",
    "paladinlibra1022@gmail.com",   // 備用，主帳號登不進去時才用
    "colorfashion180@gmail.com",
    "kitt34342006@gmail.com",
    "lunhs7787@gmail.com",
    "sidney850318@gmail.com",
    "uu6566460@gmail.com",
    "uuworldlet@gmail.com"
].map(e => e.toLowerCase());

// 樣式在 common.js 載入當下就插進 <head>，不等 initAuthGate()，
// 這樣 body 的 auth-locked 一開始就有效，後台內容不會先閃一下才被蓋掉
document.head.insertAdjacentHTML('beforeend', '<style>' + `
body.auth-locked > *:not(#authGate) { display: none !important; }
#authGate { position: fixed; inset: 0; z-index: 99999; display: none; align-items: center; justify-content: center; background: linear-gradient(160deg, #f8f8f9 0%, #ececed 100%); padding: 20px; }
body.auth-locked #authGate { display: flex; }
.auth-card { width: 100%; max-width: 360px; background: #fff; border-radius: 18px; padding: 36px 28px; box-shadow: 0 18px 50px rgba(0,0,0,0.10); text-align: center; font-family: system-ui, -apple-system, "Noto Sans TC", sans-serif; }
.auth-logo { font-size: 22px; font-weight: 700; letter-spacing: 2px; color: #1a1516; }
.auth-sub { font-size: 13px; color: #9a9a9a; margin-top: 6px; letter-spacing: 1px; }
.auth-checking { margin-top: 30px; font-size: 14px; color: #9a9a9a; }
.auth-google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 13px; font-size: 15px; font-weight: 600; color: #3c4043; background: #fff; border: 1px solid #dadce0; border-radius: 10px; cursor: pointer; }
.auth-divider { display: flex; align-items: center; gap: 12px; margin: 20px 0; color: #c0c0c0; font-size: 12px; }
.auth-divider::before, .auth-divider::after { content: ""; flex: 1; height: 1px; background: #ebebeb; }
.auth-input { width: 100%; box-sizing: border-box; padding: 12px 14px; margin-bottom: 10px; font-size: 15px; border: 1px solid #e5e5e5; border-radius: 10px; outline: none; }
.auth-input:focus { border-color: #2c2c2c; }
.auth-submit { width: 100%; padding: 13px; font-size: 15px; font-weight: 600; color: #fff; background: #2c2c2c; border: none; border-radius: 10px; cursor: pointer; }
.auth-google:disabled, .auth-submit:disabled { opacity: .5; cursor: default; }
.auth-note { background: #fff8e6; border: 1px solid #f3e2b3; color: #8a6d3b; border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; text-align: left; }
.auth-error { margin-top: 16px; font-size: 13px; color: #d9534f; line-height: 1.5; min-height: 18px; }
` + '</style>');

let _auth = null;
let _authDenyMsg = "";   // 被擋下的原因，等登出完成後才顯示，才不會被蓋掉
const _GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function _isInAppBrowser() {
    return /\bLine\/|Instagram|FBAN|FBAV|; wv\)/i.test(navigator.userAgent || "");
}

function initAuthGate() {
    _auth = firebase.auth();
    document.body.insertAdjacentHTML('afterbegin', `
<div id="authGate">
    <div class="auth-card">
        <div class="auth-logo">COLOR FASHION</div>
        <div class="auth-sub">後台管理系統</div>
        <div id="authChecking" class="auth-checking">檢查登入狀態…</div>
        <div id="authBody" style="display:none; margin-top:26px;">
            <div id="authInAppNote" class="auth-note" style="display:none;">App 內建瀏覽器不支援 Google 登入。<br>請用下方帳號密碼，或改用 Safari／Chrome 開啟本頁。</div>
            <button id="googleLoginBtn" class="auth-google" onclick="loginWithGoogle()">${_GOOGLE_G}<span>使用 Google 帳號登入</span></button>
            <div class="auth-divider">或</div>
            <input type="email" id="authEmail" class="auth-input" placeholder="電子郵件" autocomplete="username">
            <input type="password" id="authPassword" class="auth-input" placeholder="密碼" autocomplete="current-password" onkeydown="if(event.key==='Enter') loginWithEmail()">
            <button id="emailLoginBtn" class="auth-submit" onclick="loginWithEmail()">登入</button>
        </div>
        <div id="authError" class="auth-error"></div>
    </div>
</div>`);

    if (_isInAppBrowser()) {
        document.getElementById('googleLoginBtn').style.display = 'none';
        document.querySelector('#authBody .auth-divider').style.display = 'none';
        document.getElementById('authInAppNote').style.display = 'block';
    }

    _auth.onAuthStateChanged(function (user) {
        const email = (user && user.email) ? user.email.toLowerCase() : "";
        if (user && ADMIN_EMAILS.includes(email)) { document.body.classList.remove('auth-locked'); return; }
        if (user) {
            _authDenyMsg = "⛔ " + (user.email || "這個帳號") + " 沒有後台權限";
            _auth.signOut();
            return;
        }
        document.body.classList.add('auth-locked');
        document.getElementById('authChecking').style.display = 'none';
        document.getElementById('authBody').style.display = 'block';
        document.getElementById('authError').textContent = _authDenyMsg;
        _authDenyMsg = "";
    });
    _auth.getRedirectResult().catch(err => { _authDenyMsg = _authErrText(err); });
}

function _authBusy(on) {
    document.getElementById('googleLoginBtn').disabled = on;
    const b = document.getElementById('emailLoginBtn');
    b.disabled = on;
    b.textContent = on ? "登入中…" : "登入";
}

function _authErrText(err) {
    const map = {
        'auth/invalid-email': '電子郵件格式不正確',
        'auth/user-not-found': '帳號或密碼錯誤',
        'auth/wrong-password': '帳號或密碼錯誤',
        'auth/invalid-credential': '帳號或密碼錯誤',
        'auth/too-many-requests': '嘗試次數過多，請稍後再試',
        'auth/network-request-failed': '網路連線失敗，請檢查網路',
        'auth/operation-not-allowed': '這種登入方式尚未啟用（Firebase → Authentication → 登入方式）',
        'auth/user-disabled': '這個帳號已被停用，請到 Firebase Console 重新啟用或刪除後重建',
        'auth/unauthorized-domain': '這個網域尚未授權（Firebase → Authentication → Settings → 授權網域）'
    };
    return map[err.code] || (err.message || String(err));
}

function loginWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    _authBusy(true);
    document.getElementById('authError').textContent = "";
    _auth.signInWithPopup(provider)
        .catch(err => {
            // 不要退回 signInWithRedirect：本站在 github.io、Firebase 登入處理頁在
            // firebaseapp.com，跨網域的 sessionStorage 會被 Safari 16.1+ 與
            // LINE/IG 這類 App 內建瀏覽器切斷，跳轉回來一定出現
            // 「missing initial state」。而會擋彈窗的正好就是這些瀏覽器。
            if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment') {
                document.getElementById('authError').innerHTML =
                    '這個瀏覽器不支援 Google 登入。<br>請改用下方的電子郵件與密碼，' +
                    '或用 Safari／Chrome 開啟本頁。';
                return;
            }
            if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
                document.getElementById('authError').textContent = _authErrText(err);
            }
        })
        .finally(() => _authBusy(false));
}

function loginWithEmail() {
    const email = document.getElementById('authEmail').value.trim();
    const pw = document.getElementById('authPassword').value;
    if (!email || !pw) { document.getElementById('authError').textContent = "請輸入電子郵件與密碼"; return; }
    _authBusy(true);
    document.getElementById('authError').textContent = "";
    _auth.signInWithEmailAndPassword(email, pw)
        .catch(err => { document.getElementById('authError').textContent = _authErrText(err); })
        .finally(() => _authBusy(false));
}

// 登出後整頁重載，把記憶體裡已載入的會員／預約／庫存資料一併清掉
function logout() {
    if (!confirm("確定要登出後台嗎？")) return;
    _auth.signOut().then(() => location.reload());
}
