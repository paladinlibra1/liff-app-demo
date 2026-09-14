/**
 * 電話正規化與驗證 — 前端與 Worker 共用
 *
 * ⚠️ 刻意放在共用檔：客人端要在送出前先擋一次（不然填錯要等送出才知道），
 *    Worker 也一定要再擋一次（前端的檢查任何人都繞得過）。
 *    規則如果各寫一份，遲早會走鐘成「前端說可以、後端說不行」。
 */

// 這幾行不是裝飾。客人常常從通訊錄或 LINE 訊息直接貼上，
// 會帶全形數字、各種連字號、甚至 +886 開頭。舊系統踩過才長這樣。

export function normalizePhone(phone: string): string {
  return (phone || "")
    // 全形數字轉半形
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
    // 全形加號轉半形：舊系統漏了這個，＋886... 會被判定成無效電話
    .replace(/＋/g, "+")
    // 空白、各式連字號、點、全形括號一律當分隔符號清掉
    .replace(/[\s\-‐‑‒–—−ー.．()（）]/g, "")
    // 國際碼寫法轉回本地：+886912345678 → 0912345678
    .replace(/^\+?886/, "0");
}

export function isValidPhone(phone: string): boolean {
  const p = normalizePhone(phone);
  if (!/^0\d+$/.test(p)) return false;
  if (p.startsWith("09")) return p.length === 10;   // 手機固定 10 碼
  return p.length === 9 || p.length === 10;         // 市話含區碼
}

export const PHONE_RULE_MSG =
  "電話格式不正確。手機請輸入 09 開頭的 10 碼；市話請含區碼，共 9 或 10 碼。";
