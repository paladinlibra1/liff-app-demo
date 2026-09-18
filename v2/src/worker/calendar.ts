/**
 * Google 日曆同步
 *
 * 舊系統是 GAS，`CalendarApp` 以專案擁有者的身分執行，不用處理授權；
 * Cloudflare 上沒有這種好康，**一定要服務帳戶**：自己簽一張 JWT 去換
 * access token，再打 Calendar REST API。
 *
 * 需要三個 Worker secret（沒設就整個跳過，不影響預約）：
 *   GOOGLE_SA_EMAIL        服務帳戶的信箱
 *   GOOGLE_SA_PRIVATE_KEY  服務帳戶金鑰的 PEM（BEGIN PRIVATE KEY 那一段）
 *   GOOGLE_CALENDAR_ID     要寫進哪個日曆，而且那個日曆要分享給上面那個信箱
 *
 * ⚠️ 跟 LINE 推播一樣是「送出去就算了」：日曆寫不進去絕對不能讓預約失敗。
 *    客人已經訂到位子了，卻因為 Google 出問題而回報失敗是最糟的結果。
 *    呼叫端一律用 ctx.waitUntil() 丟到背景。
 */

import type { Env } from "./index";
import { sb, type Store } from "./supabase";

export type CalendarKind = "new" | "change" | "cancel";

/** 一筆預約在日曆上佔多久。沿用舊系統的 30 分鐘 */
const SLOT_MINUTES = 30;

/**
 * 事件顏色，照舊系統 GAS 那組（CalendarApp.EventColor → API 的 colorId）：
 * 新客體驗 香蕉黃、一般預約 羅勒綠、複檢 孔雀藍、其他 番茄紅。
 * 店家看日曆是用顏色分類型的，換一組顏色等於整本日曆的意義都變了。
 */
const COLOR: Record<string, string> = {
  新客體驗: "5",
  一般預約: "10",
  複檢: "7",
};
const COLOR_OTHER = "11";

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  name: string;
  name2: string | null;
  phone: string;
  type: string;
  remark: string | null;
  status: string;
  calendar_event_id: string | null;
}

// ───────────────────────────────────────────────────────────
// 服務帳戶：JWT → access token
// ───────────────────────────────────────────────────────────

/**
 * token 在同一個 isolate 裡共用。
 *
 * Google 給的有效期是一小時，每次同步都重換一張等於多打一次 API、多等 200ms。
 * isolate 會被回收，所以這只是機會性的快取，不是需要維護的狀態。
 */
let cached: { token: string; expiresAt: number } | null = null;

function b64url(data: ArrayBuffer | string): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM → DER。secret 用 wrangler 貼進去時換行可能變成字面上的 \n，兩種都收 */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env: Env): Promise<string | null> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY) return null;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.GOOGLE_SA_EMAIL,
    // 只要事件的權限就夠，不要整本日曆的管理權
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const head = { alg: "RS256", typ: "JWT" };
  const unsigned = `${b64url(JSON.stringify(head))}.${b64url(JSON.stringify(claim))}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8", pemToDer(env.GOOGLE_SA_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
  } catch (err) {
    console.error("GOOGLE_SA_PRIVATE_KEY 讀不出來，請確認貼的是 PEM 全文", err);
    return null;
  }

  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(unsigned));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) {
    console.error("換 Google token 失敗", res.status, (await res.text()).slice(0, 300));
    return null;
  }

  const body = await res.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

// ───────────────────────────────────────────────────────────
// 事件內容
// ───────────────────────────────────────────────────────────

/** 標題只放人名，跟舊系統一樣——日曆的月檢視只看得到前幾個字 */
function title(b: BookingRow): string {
  return b.name2 ? `${b.name}、${b.name2}` : b.name;
}

function description(b: BookingRow): string {
  const time = b.start_time.slice(0, 5);
  return [
    `日期：${b.date}`,
    `時間：${time}`,
    `身分：${b.type}`,
    `電話：${b.phone || "無"}`,
    `同行：${b.name2 || "無"}`,
    `客需備註：${b.remark?.trim() || "無"}`,
    `系統ID：${b.id}`,
  ].join("\n");
}

/** `HH:MM` 加上 30 分鐘。跨過整點要進位，所以不能只加分鐘 */
function endTime(start: string): string {
  const [h, m] = start.split(":").map(Number);
  const total = h * 60 + m + SLOT_MINUTES;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function eventBody(b: BookingRow, timezone: string) {
  const start = b.start_time.slice(0, 5);
  return {
    summary: title(b),
    description: description(b),
    colorId: COLOR[b.type] ?? COLOR_OTHER,
    // 帶 timeZone 讓 Google 自己換算，Worker 不用處理台灣時區與日光節約
    start: { dateTime: `${b.date}T${start}:00`, timeZone: timezone },
    end: { dateTime: `${b.date}T${endTime(start)}:00`, timeZone: timezone },
  };
}

// ───────────────────────────────────────────────────────────
// 同步
// ───────────────────────────────────────────────────────────

async function callCalendar(
  env: Env, token: string, path: string, init: RequestInit,
): Promise<Response> {
  return fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID!)}/events${path}`,
    {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    },
  );
}

/**
 * 把一筆預約同步到日曆。
 *
 * 刻意只收 bookingId 再自己查一次，而不是讓六個呼叫端各自湊出一個物件：
 * 這裡需要的 calendar_event_id 呼叫端多半沒帶，湊漏了就會變成每次都新建事件。
 */
export async function syncCalendar(
  env: Env, store: Store, bookingId: string, kind: CalendarKind,
): Promise<void> {
  if (!env.GOOGLE_CALENDAR_ID) return;          // 沒設定就當作沒這功能

  try {
    const rows = await sb<BookingRow[]>(
      env,
      `bookings?id=eq.${bookingId}&store_id=eq.${store.id}` +
        `&select=id,date,start_time,name,name2,phone,type,remark,status,calendar_event_id&limit=1`,
    );
    const b = rows[0];
    if (!b) return;

    const token = await getAccessToken(env);
    if (!token) return;

    // 取消：刪掉事件。已經被人手動刪掉的會回 404/410，那也算達成目的
    if (kind === "cancel" || b.status === "cancelled") {
      if (!b.calendar_event_id) return;
      const res = await callCalendar(env, token, `/${encodeURIComponent(b.calendar_event_id)}`,
        { method: "DELETE" });
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        console.error("刪除日曆事件失敗", res.status, (await res.text()).slice(0, 200));
        return;
      }
      await clearEventId(env, b.id);
      return;
    }

    const body = JSON.stringify(eventBody(b, store.timezone));

    // 改時間：同一個事件 PATCH 過去，不要刪掉重建——
    // 重建會換一個 id，客人手機上那則日曆提醒也會重來一次
    if (b.calendar_event_id) {
      const res = await callCalendar(env, token,
        `/${encodeURIComponent(b.calendar_event_id)}`, { method: "PATCH", body });
      if (res.ok) return;
      if (res.status !== 404 && res.status !== 410) {
        console.error("更新日曆事件失敗", res.status, (await res.text()).slice(0, 200));
        return;
      }
      // 事件被人在日曆上手動刪掉了 → 往下重新建一個
    }

    const res = await callCalendar(env, token, "", { method: "POST", body });
    if (!res.ok) {
      console.error("建立日曆事件失敗", res.status, (await res.text()).slice(0, 300));
      return;
    }
    const created = await res.json() as { id?: string };
    if (created.id) await saveEventId(env, b.id, created.id);
  } catch (err) {
    // 日曆失敗不影響預約本身，記 log 就好
    console.error("日曆同步例外", err);
  }
}

async function saveEventId(env: Env, bookingId: string, eventId: string): Promise<void> {
  await sb(env, `bookings?id=eq.${bookingId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ calendar_event_id: eventId }),
  });
}

async function clearEventId(env: Env, bookingId: string): Promise<void> {
  await sb(env, `bookings?id=eq.${bookingId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ calendar_event_id: null }),
  });
}
