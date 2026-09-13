/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║  潮州店預約系統 — Cloudflare Worker                        ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * 這個 Worker 同時是：
 *   1. 客人端的 API（客人不直連 Supabase，一律走這裡）
 *   2. 之後的 LINE 推播 / Google 日曆同步 / 排程
 *   3. 之後 React 打包檔的靜態主機（同源，免 CORS）
 *
 * 後台店員是另一條路：直連 Supabase，用原生 Auth + RLS，不經過這裡。
 */

import { verifyLineToken, bearerToken, LineAuthError } from "./line";

export interface Env {
  LINE_LOGIN_CHANNEL_ID: string;
  SUPABASE_URL: string;
  /** sb_secret_... 繞過 RLS，只存在於 Worker secret，絕不外流 */
  SUPABASE_SECRET_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── 健康檢查 ────────────────────────────────────────
    if (path === "/api/health") {
      return json({
        status: "ok",
        lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
        // 只回報有沒有設定，不回報值
        hasSupabaseKey: Boolean(env.SUPABASE_SECRET_KEY),
      });
    }

    // ── 我是誰：驗證 LIFF token，回傳 LINE 身分 ──────────
    if (path === "/api/auth/me") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      try {
        const profile = await verifyLineToken(
          bearerToken(request),
          env.LINE_LOGIN_CHANNEL_ID,
        );
        return json({
          lineUserId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl ?? null,
        });
      } catch (err) {
        if (err instanceof LineAuthError) {
          return json({ error: err.message }, err.status);
        }
        console.error("驗證失敗", err);
        return json({ error: "驗證時發生錯誤" }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
