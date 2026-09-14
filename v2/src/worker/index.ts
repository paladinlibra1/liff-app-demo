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
import { getStore, timesForDate, SupabaseError } from "./supabase";

export interface Env {
  /** 前端打包後的靜態檔（dist/），非 /api 的路徑一律交給它 */
  ASSETS: Fetcher;
  LINE_LOGIN_CHANNEL_ID: string;
  /** 這個 Worker 服務哪一家店（stores.slug） */
  STORE_SLUG: string;
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

/** 把後端例外轉成對外的 JSON 錯誤：對客人講人話，細節只留在 log */
function errorResponse(err: unknown, fallback: string): Response {
  if (err instanceof SupabaseError) {
    console.error(fallback, err.message);
    // 資料庫的錯誤訊息可能含 schema 細節，不往外送
    return json({ error: fallback }, 500);
  }
  console.error(fallback, err);
  return json({ error: fallback }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Worker 只負責 /api，其餘（含 SPA fallback）交給靜態資源。
    // 少了這段，Worker 會把每個前端路由都回成 404。
    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // ── 健康檢查 ────────────────────────────────────────
    if (path === "/api/health") {
      return json({
        status: "ok",
        lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
        // 只回報有沒有設定，不回報值
        hasSupabaseKey: Boolean(env.SUPABASE_SECRET_KEY),
      });
    }

    // ── 店家設定：店名與營業時段 ────────────────────────
    // 不需要登入：這些是店門口就看得到的公開資訊，
    // 而且客人端要先拿到時段才能畫出預約表單。
    if (path === "/api/store") {
      try {
        const store = await getStore(env);
        return json({
          name: store.name,
          timezone: store.timezone,
          // 平日／假日兩組，店家可在後台自行設定
          businessHours: {
            weekday: store.business_hours?.weekday ?? [],
            weekend: store.business_hours?.weekend ?? [],
          },
        });
      } catch (err) {
        return errorResponse(err, "讀取店家設定失敗");
      }
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
