/**
 * LINE access token 驗證
 *
 * 客人從 LIFF 進來，前端拿 liff.getAccessToken() 附在 Authorization header。
 * Worker 每次都跟 LINE 驗證一次——不自己發 session token。
 *
 * 為什麼不自己發 session：
 *   自己簽 token 就要管簽章金鑰、過期、撤銷，是一整套容易寫錯的東西。
 *   LIFF token 本來就有期限，多打一次 LINE API（約 100ms）換掉整套風險，划算。
 */

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
}

export class LineAuthError extends Error {
  constructor(message: string, readonly status: number = 401) {
    super(message);
  }
}

/**
 * 驗證 access token 並取回使用者資料。
 *
 * ⚠️ 這裡最關鍵的是 client_id 檢查。LINE 的 verify 端點會告訴你這個 token
 *    是「哪一個 LINE Login channel」發出的。少了這個檢查，任何人都可以拿
 *    別的 LINE 應用程式的 token 來這裡登入別人的帳號。
 */
export async function verifyLineToken(
  accessToken: string,
  expectedChannelId: string,
): Promise<LineProfile> {
  if (!accessToken) {
    throw new LineAuthError("缺少 access token");
  }

  // ── 1. 驗證 token 本身 ──────────────────────────────
  const verifyRes = await fetch(
    "https://api.line.me/oauth2/v2.1/verify?access_token=" +
      encodeURIComponent(accessToken),
  );

  if (!verifyRes.ok) {
    throw new LineAuthError("LINE token 無效或已過期");
  }

  const verified = (await verifyRes.json()) as {
    client_id?: string;
    expires_in?: number;
  };

  // token 是不是「我們這個 channel」發的
  if (verified.client_id !== expectedChannelId) {
    throw new LineAuthError("這個 token 不屬於本店的 LINE channel", 403);
  }

  // LINE 對已過期的 token 會回 400，這裡是防呆
  if (typeof verified.expires_in === "number" && verified.expires_in <= 0) {
    throw new LineAuthError("LINE token 已過期");
  }

  // ── 2. 取使用者資料 ─────────────────────────────────
  const profileRes = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: "Bearer " + accessToken },
  });

  if (!profileRes.ok) {
    throw new LineAuthError("讀取 LINE 個人資料失敗");
  }

  const profile = (await profileRes.json()) as LineProfile;

  if (!profile.userId) {
    throw new LineAuthError("LINE 沒有回傳 userId");
  }

  return profile;
}

/** 從 Authorization header 取出 Bearer token */
export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}
