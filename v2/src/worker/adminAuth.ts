/**
 * 後台身分驗證
 *
 * 後台平常是直連 Supabase、靠 RLS 把關，不經過 Worker。
 * 但「代客預約要發 LINE」這件事只有 Worker 做得到（推播 token 只存在這裡），
 * 所以那一支 API 得自己驗一次身分——不能因為多開了一支路徑，
 * 就讓任何人都能用店家的名義建預約、順便叫系統發 LINE 給別人。
 *
 * 驗法：拿前端帶來的 Supabase access token 去問 Supabase「你是誰」，
 * 再用 service key 查那個人是不是這家店的後台人員。
 * 兩步都要：只驗 token 只能證明「是某個登入者」，證明不了「是這家店的店員」。
 */

import type { Env } from "./index";
import { sb, type Store } from "./supabase";
import { bearerToken } from "./line";

export class AdminAuthError extends Error {
  constructor(message: string, readonly status: number = 401) {
    super(message);
  }
}

export interface AdminUser {
  id: string;
  email: string | null;
  /** owner 或 staff */
  role: string;
}

export async function verifyAdmin(
  env: Env,
  request: Request,
  store: Store,
): Promise<AdminUser> {
  const token = bearerToken(request);
  if (!token) throw new AdminAuthError("請先登入後台");

  // ── 1) 這個 token 是誰 ──────────────────────────────
  // 讓 Supabase 自己驗簽章與有效期，我們不在 Worker 裡自己解 JWT：
  // 自己解就得自己處理金鑰輪替與撤銷，做錯了是靜默的安全漏洞。
  let res: Response;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SECRET_KEY,
        Authorization: "Bearer " + token,
      },
    });
  } catch {
    throw new AdminAuthError("無法連線驗證身分，請稍後再試", 503);
  }

  if (!res.ok) {
    throw new AdminAuthError("登入已過期，請重新登入後台");
  }

  const user = (await res.json()) as { id?: string; email?: string };
  if (!user.id) throw new AdminAuthError("登入已過期，請重新登入後台");

  // ── 2) 這個人是不是這家店的後台人員 ─────────────────
  const rows = await sb<{ role: string }[]>(
    env,
    `store_admins?store_id=eq.${store.id}` +
      `&user_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
  );
  if (!rows[0]) {
    throw new AdminAuthError("這個帳號沒有這家店的後台權限", 403);
  }

  return { id: user.id, email: user.email ?? null, role: rows[0].role };
}
