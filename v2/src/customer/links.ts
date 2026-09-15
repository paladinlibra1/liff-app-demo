/**
 * 客人端頁面之間的連結
 *
 * 一定要走 liff.line.me，不能只跳本站的路徑：預約頁與「我的預約」是兩個
 * 獨立的 LIFF 應用程式，LIFF 規定頁面要用「開啟它的那個應用程式」的 ID
 * 去 init。直接跳 `/` 會在錯的 LIFF 環境裡載入預約頁，init 時就掛了。
 *
 * ID 從環境變數來，不寫死——換店時只要改 `.env`。
 */

/** 預約頁 */
export const BOOKING_URL = `https://liff.line.me/${import.meta.env.VITE_LIFF_ID_BOOKING}`;

/** 我的預約 */
export const MY_URL = `https://liff.line.me/${import.meta.env.VITE_LIFF_ID_MY}`;

/**
 * 會員綁定頁。
 *
 * 跟「我的預約」共用同一個 LIFF：LIFF 允許在網址後面接路徑，
 * 接了之後會開到端點網址的那個子路徑，init 用的仍然是同一個 ID，
 * 所以不必為綁定頁另外申請一個 LIFF 應用程式。
 */
export const REGISTER_URL = `${MY_URL}/register`;
