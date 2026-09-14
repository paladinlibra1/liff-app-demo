/**
 * 從 Worker 讀寫 Supabase
 *
 * 客人沒有 Supabase 帳號，所以客人端一律走這裡，用 secret key 打 PostgREST。
 * secret key 會繞過 RLS ⇒ **權限判斷的責任在這一層**，資料庫不會再幫忙擋。
 * 每支客人端 API 都必須自己把查詢限制在「這家店」而且「這個 LINE 使用者」。
 */

import type { Env } from "./index";

export class SupabaseError extends Error {
  constructor(message: string, readonly status: number = 500) {
    super(message);
  }
}

function headers(env: Env): HeadersInit {
  if (!env.SUPABASE_SECRET_KEY) {
    // 本機常見狀況：忘了建 .dev.vars。講清楚，免得看到一串 401 猜半天。
    throw new SupabaseError("Worker 沒有 SUPABASE_SECRET_KEY，請檢查 .dev.vars 或 wrangler secret", 500);
  }
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
  };
}

/** 打 PostgREST。path 是 `rest/v1/` 後面那一段，例如 `stores?slug=eq.chaozhou` */
export async function sb<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers(env), ...(init.headers as Record<string, string> | undefined) },
  });

  const text = await res.text();

  if (!res.ok) {
    // PostgREST 的錯誤是 JSON，但連不上時可能是 HTML，所以兩種都要能處理
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) detail = parsed.message;
    } catch { /* 不是 JSON 就用原文 */ }
    throw new SupabaseError(detail || `Supabase 回應 ${res.status}`, res.status);
  }

  return (text ? JSON.parse(text) : null) as T;
}

// ───────────────────────────────────────────────────────────
// 店家設定
// ───────────────────────────────────────────────────────────

export interface BusinessHours {
  /** 週一～週五 */
  weekday: string[];
  /** 週六、週日 */
  weekend: string[];
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  business_hours: Partial<BusinessHours>;
}

/**
 * 取得這個 Worker 服務的那家店。
 *
 * 這裡刻意不快取：營業時段是店家在後台隨時會改的東西，
 * 快取住的話店員改完要等 TTL 過了客人才看得到。
 * 一次查詢約 20ms，先以「改完立刻生效」為準，之後真的成為瓶頸再加快取。
 */
export async function getStore(env: Env): Promise<Store> {
  const rows = await sb<Store[]>(
    env,
    `stores?slug=eq.${encodeURIComponent(env.STORE_SLUG)}` +
      `&select=id,slug,name,timezone,business_hours&limit=1`,
  );

  const store = rows[0];
  if (!store) {
    throw new SupabaseError(`找不到店家 ${env.STORE_SLUG}，seed migration 是不是還沒跑？`, 500);
  }
  return store;
}

/**
 * 某一天適用哪一組時段。
 *
 * 平日／假日兩組，是店家在後台自己設定的。
 * 週日要不要營業由 operating_days 決定，不是靠「週日沒有時段」擋掉——
 * 舊系統就是後者，結果週日永遠開不了。
 *
 * @param date `YYYY-MM-DD`
 */
export function timesForDate(store: Store, date: string): string[] {
  // 用 UTC 解析再取星期，避免跑在不同時區的機器上算出差一天。
  // 日期字串本身沒有時間概念，所以這樣是安全的。
  const day = new Date(date + "T00:00:00Z").getUTCDay(); // 0=日 … 6=六
  const isWeekend = day === 0 || day === 6;
  const hours = store.business_hours ?? {};
  return (isWeekend ? hours.weekend : hours.weekday) ?? [];
}
