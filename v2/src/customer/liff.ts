import liff from "@line/liff";

/**
 * LIFF 身分
 *
 * 客人從 LINE 裡開啟這一頁，LIFF 給我們 access token，
 * Worker 每次都拿去跟 LINE 驗一次（見 src/worker/line.ts）。
 */
export interface Viewer {
  userId: string;
  displayName: string;
  accessToken: string;
}

/** 沒有 LIFF 可用時的狀態，讓畫面知道要顯示什麼 */
export type LiffState =
  | { kind: "ready"; viewer: Viewer }
  | { kind: "preview"; reason: string }   // 開發機上沒設 LIFF ID，只看畫面
  | { kind: "error"; message: string };

/**
 * 啟動 LIFF 並取得身分。
 *
 * 開發時的處理：本機沒有設 `VITE_LIFF_ID` 就進入「預覽模式」——畫面照畫，
 * 但沒有 LINE 身分。這**不是**驗證的後門：Worker 那端一律要真的 token，
 * 預覽模式下按送出會被 401 擋掉，拿不到任何資料。
 * 而且這段用 `import.meta.env.DEV` 包住，正式打包根本不會包進去。
 */
export async function initLiff(which: "booking" | "my"): Promise<LiffState> {
  // 兩個頁面是兩個獨立的 LIFF 應用程式，各自有 ID。
  // LIFF 規定：頁面要用「開啟它的那個應用程式」的 ID 去 init，
  // 拿另一個的 ID 會失敗，所以不能共用一個變數。
  const liffId =
    which === "booking"
      ? import.meta.env.VITE_LIFF_ID_BOOKING
      : import.meta.env.VITE_LIFF_ID_MY;

  if (!liffId) {
    if (import.meta.env.DEV) {
      return { kind: "preview", reason: `本機沒有設定 ${which === "booking" ? "VITE_LIFF_ID_BOOKING" : "VITE_LIFF_ID_MY"}` };
    }
    return { kind: "error", message: "系統設定不完整，請聯絡店家" };
  }

  try {
    await liff.init({ liffId });

    if (!liff.isLoggedIn()) {
      // 導去 LINE 登入，回來之後這支會重跑一次
      liff.login({ redirectUri: window.location.href });
      return { kind: "error", message: "正在前往 LINE 登入…" };
    }

    const accessToken = liff.getAccessToken();
    if (!accessToken) {
      return { kind: "error", message: "取得 LINE 身分失敗，請重新開啟一次" };
    }

    const profile = await liff.getProfile();
    return {
      kind: "ready",
      viewer: {
        userId: profile.userId,
        displayName: profile.displayName,
        accessToken,
      },
    };
  } catch (err) {
    console.error("LIFF 啟動失敗", err);
    return { kind: "error", message: "無法連上 LINE，請從 LINE 裡重新開啟這個頁面" };
  }
}

/** 送出成功後把視窗關掉（只有在 LINE 裡開才有作用） */
export function closeLiffWindow() {
  try {
    if (liff.isInClient()) liff.closeWindow();
  } catch {
    /* 不在 LINE 裡就什麼都不做 */
  }
}
