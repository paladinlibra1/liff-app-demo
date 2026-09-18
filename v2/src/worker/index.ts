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
import { getStore, SupabaseError } from "./supabase";
import { getAvailability, todayInStore } from "./availability";
import {
  createBooking, createAdminBooking, adminSetBookingStatus, adminRescheduleBooking,
  getMyProfile, registerMember, BookingError,
  type BookingInput, type AdminBookingInput, type RegisterInput,
} from "./bookings";
import { verifyAdmin, AdminAuthError } from "./adminAuth";
import { sendFollowUps, FollowUpError } from "./followups";
import { listMyBookings, cancelMyBooking, rescheduleMyBooking } from "./myBookings";
import { notifyBooking } from "./linePush";
import { handleLineWebhook } from "./lineWebhook";
import { sendDailyReminders } from "./reminders";

export interface Env {
  /** 前端打包後的靜態檔（dist/），非 /api 的路徑一律交給它 */
  ASSETS: Fetcher;
  LINE_LOGIN_CHANNEL_ID: string;
  /** Messaging API 的長效 token，推播用。沒設就不推 */
  LINE_CHANNEL_ACCESS_TOKEN: string;
  /**
   * 店家群組的 id。
   *
   * 平常不用設——webhook 會在官方帳號被加進群組時自動寫進
   * stores.line_group_id。設了這個就蓋過資料庫的值，留給手動指定用。
   */
  STORE_GROUP_ID?: string;
  /** Messaging API 的 channel secret，驗 webhook 簽章用 */
  LINE_CHANNEL_SECRET?: string;
  /** 「更改或取消預約」按鈕要導去的 LIFF 網址 */
  LIFF_MY_URL?: string;
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

/** 只接受 YYYY-MM-DD，而且要是真的存在的日期（擋掉 2026-02-31） */
function isDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 含頭含尾的天數 */
function dayCount(from: string, to: string): number {
  const ms = new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime();
  return Math.floor(ms / 86400000) + 1;
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Worker 只負責 /api，其餘（含 SPA fallback）交給靜態資源。
    // 少了這段，Worker 會把每個前端路由都回成 404。
    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // ── LINE 的 webhook ─────────────────────────────────
    // 只為了取得店家群組的 ID：那個 ID 只有在官方帳號被加進群組時，
    // LINE 才會送過來，沒有任何介面查得到。
    if (path === "/api/line/webhook") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      try {
        const store = await getStore(env);
        return await handleLineWebhook(env, request, store);
      } catch (err) {
        // 這支不能回錯誤碼給 LINE，否則它會一直重送
        console.error("webhook 處理失敗", err);
        return new Response("ok");
      }
    }

    // ── 健康檢查 ────────────────────────────────────────
    if (path === "/api/health") {
      return json({
        status: "ok",
        lineChannelId: env.LINE_LOGIN_CHANNEL_ID,
        // 只回報有沒有設定，不回報值
        hasSupabaseKey: Boolean(env.SUPABASE_SECRET_KEY),
        hasLineSecret: Boolean(env.LINE_CHANNEL_SECRET),
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

    // ── 可預約狀況：哪幾天有開、每個時段還剩幾位 ────────
    // 不含任何客人資料，只回「剩幾位」，所以跟 /api/store 一樣不需要登入。
    if (path === "/api/availability") {
      try {
        const store = await getStore(env);
        const today = todayInStore(store);

        const from = url.searchParams.get("from") || today;
        // 預設往後 30 天，剛好夠月曆畫一頁
        const to = url.searchParams.get("to") || addDays(from, 30);

        if (!isDate(from) || !isDate(to)) {
          return json({ error: "日期格式要是 YYYY-MM-DD" }, 400);
        }
        if (to < from) {
          return json({ error: "結束日期不能早於開始日期" }, 400);
        }
        // 上限擋住「查一整年」這種會把資料庫拖垮的請求
        if (dayCount(from, to) > 62) {
          return json({ error: "一次最多查 62 天" }, 400);
        }

        return json({ from, to, days: await getAvailability(env, store, from, to) });
      } catch (err) {
        return errorResponse(err, "讀取可預約時段失敗");
      }
    }

    // ── 建立預約 ────────────────────────────────────────
    // 這支一定要驗身分：預約會綁到會員、之後也要靠 LINE 推播通知。
    if (path === "/api/bookings" && request.method === "POST") {
      try {
        const profile = await verifyLineToken(
          bearerToken(request),
          env.LINE_LOGIN_CHANNEL_ID,
        );

        let input: BookingInput;
        try {
          input = (await request.json()) as BookingInput;
        } catch {
          return json({ error: "送出的內容格式不正確" }, 400);
        }

        const store = await getStore(env);
        const booking = await createBooking(env, store, profile, input);

        // 推播丟到背景：客人已經訂到位子了，不該因為 LINE 送不出去而等待或失敗
        ctx.waitUntil(notifyBooking(env, store, {
          date: booking.date,
          time: booking.start_time.slice(0, 5),
          name: booking.name,
          name2: booking.name2,
          phone: booking.phone,
          type: booking.type,
          remark: booking.remark,
          notifyLineUserId: booking.notify_line_user_id,
          lineName: profile.displayName,
        }, "new"));

        return json({ booking }, 201);
      } catch (err) {
        // 欄位沒填、額滿、重複預約 → 直接把訊息給客人看
        if (err instanceof BookingError) {
          return json({ error: err.message }, err.status);
        }
        if (err instanceof LineAuthError) {
          return json({ error: err.message }, err.status);
        }
        return errorResponse(err, "建立預約失敗");
      }
    }

    // ── 會員綁定 ────────────────────────────────────────
    // 客人第一次開「我的預約」會被擋在這一步。已經綁過的再送一次
    // 也不會出錯，會直接回現有的資料。
    if (path === "/api/members" && request.method === "POST") {
      try {
        const profile = await verifyLineToken(
          bearerToken(request),
          env.LINE_LOGIN_CHANNEL_ID,
        );

        let input: RegisterInput;
        try {
          input = (await request.json()) as RegisterInput;
        } catch {
          return json({ error: "送出的內容格式不正確" }, 400);
        }

        const store = await getStore(env);
        const member = await registerMember(env, store, profile, input);
        return json({ member }, 201);
      } catch (err) {
        if (err instanceof BookingError) return json({ error: err.message }, err.status);
        if (err instanceof LineAuthError) return json({ error: err.message }, err.status);
        return errorResponse(err, "綁定會員失敗");
      }
    }

    // ── 代客預約：店家幫客人訂 ──────────────────────────
    // 後台平常直連 Supabase，只有這支走 Worker——因為要發 LINE，
    // 而推播的 token 只存在 Worker。身分自己驗一次，不能因為多開一支路徑
    // 就讓任何人都能用店家名義建預約、順便叫系統發 LINE 給別人。
    if (path === "/api/admin/bookings" && request.method === "POST") {
      try {
        const store = await getStore(env);
        await verifyAdmin(env, request, store);

        let input: AdminBookingInput;
        try {
          input = (await request.json()) as AdminBookingInput;
        } catch {
          return json({ error: "送出的內容格式不正確" }, 400);
        }

        const booking = await createAdminBooking(env, store, input);

        // 推播丟到背景：單子已經建好了，不該因為 LINE 送不出去而失敗
        ctx.waitUntil(notifyBooking(env, store, {
          date: booking.date,
          time: booking.start_time.slice(0, 5),
          name: booking.name,
          name2: booking.name2,
          phone: booking.phone,
          type: booking.type,
          remark: booking.remark,
          notifyLineUserId: booking.notify_line_user_id,
        }, "new"));

        return json({ booking }, 201);
      } catch (err) {
        if (err instanceof BookingError) return json({ error: err.message }, err.status);
        if (err instanceof AdminAuthError) return json({ error: err.message }, err.status);
        return errorResponse(err, "建立預約失敗");
      }
    }

    // ── 後台發沉睡客關懷訊息 ────────────────────────────
    // 一樣是為了那則 LINE 才走 Worker。名單是前端算的，但「發給誰」
    // 由這裡再查一次會員決定，不照單全收。
    if (path === "/api/admin/followups/send") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      try {
        const store = await getStore(env);
        await verifyAdmin(env, request, store);

        let input: { member_ids?: unknown };
        try {
          input = (await request.json()) as typeof input;
        } catch {
          return json({ error: "送出的內容格式不正確" }, 400);
        }
        const ids = Array.isArray(input.member_ids)
          ? input.member_ids.filter((x): x is string => typeof x === "string")
          : [];

        /*
         * 這一支刻意「等它送完」才回應，跟預約通知的 waitUntil 不一樣：
         * 店家按下去就是為了發訊息，要當場知道誰成功誰失敗。
         */
        return json(await sendFollowUps(env, store, ids));
      } catch (err) {
        if (err instanceof FollowUpError) return json({ error: err.message }, err.status);
        if (err instanceof AdminAuthError) return json({ error: err.message }, err.status);
        return errorResponse(err, "發送關懷訊息失敗");
      }
    }

    // ── 後台動既有預約：標記完成 / 取消 / 改時間 ────────
    // 跟代客預約同理，走 Worker 只為了那則 LINE：店家在後台按取消或改時間，
    // 客人如果什麼都沒收到，人就白跑一趟了。
    const adminStatusMatch = path.match(
      /^\/api\/admin\/bookings\/([0-9a-f-]{36})\/status$/i,
    );
    const adminEditMatch = path.match(
      /^\/api\/admin\/bookings\/([0-9a-f-]{36})\/reschedule$/i,
    );
    if (adminStatusMatch || adminEditMatch) {
      const isEdit = Boolean(adminEditMatch);
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      try {
        const store = await getStore(env);
        await verifyAdmin(env, request, store);

        let input: {
          status?: string;
          reason?: string | null;
          date?: string;
          time?: string;
          remark?: string | null;
        };
        try {
          input = (await request.json()) as typeof input;
        } catch {
          return json({ error: "送出的內容格式不正確" }, 400);
        }

        if (isEdit) {
          const { booking, notify } = await adminRescheduleBooking(
            env, store, adminEditMatch![1], input,
          );
          ctx.waitUntil(notifyBooking(env, store, notify, "change"));
          return json({ booking });
        }

        const { booking, notify } = await adminSetBookingStatus(
          env, store, adminStatusMatch![1],
          (input.status ?? "").trim(),
          input.reason?.trim() || null,
        );

        // 標記完成不用通知任何人——那是店裡自己的紀錄，客人已經來過了
        if (booking.status === "cancelled") {
          ctx.waitUntil(notifyBooking(env, store, notify, "cancel"));
        }

        return json({ booking });
      } catch (err) {
        if (err instanceof BookingError) return json({ error: err.message }, err.status);
        if (err instanceof AdminAuthError) return json({ error: err.message }, err.status);
        return errorResponse(err, isEdit ? "更改預約失敗" : "更改預約狀態失敗");
      }
    }

    // ── 我的預約：查詢與取消 ────────────────────────────
    // 兩支都要驗身分，而且「這筆是不是你的」由後端判斷，
    // 不是前端送一個 id 過來就照做。
    const cancelMatch = path.match(/^\/api\/bookings\/([0-9a-f-]{36})\/cancel$/i);
    const editMatch = path.match(/^\/api\/bookings\/([0-9a-f-]{36})\/reschedule$/i);

    if (path === "/api/my-bookings" || cancelMatch || editMatch) {
      const isCancel = Boolean(cancelMatch);
      const isEdit = Boolean(editMatch);
      if ((isCancel || isEdit)
        ? request.method !== "POST"
        : request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405);
      }

      try {
        const profile = await verifyLineToken(
          bearerToken(request),
          env.LINE_LOGIN_CHANNEL_ID,
        );
        const store = await getStore(env);

        if (!isCancel && !isEdit) {
          return json(await listMyBookings(env, store, profile));
        }

        // ── 改期 ────────────────────────────────────
        if (isEdit) {
          let input: { date?: string; time?: string; remark?: string | null };
          try {
            input = (await request.json()) as typeof input;
          } catch {
            return json({ error: "送出的內容格式不正確" }, 400);
          }

          const { booking, notify } = await rescheduleMyBooking(
            env, store, profile, editMatch![1], input,
          );

          ctx.waitUntil(notifyBooking(
            env, store, { ...notify, lineName: profile.displayName }, "change",
          ));

          return json({ booking });
        }

        // 取消原因可有可無，送壞掉的 JSON 也不該讓取消失敗
        let reason: string | null = null;
        try {
          const body = (await request.json()) as { reason?: string };
          reason = body?.reason?.trim() || null;
        } catch { /* 沒帶 body 就是沒有原因 */ }

        const { booking, notify } = await cancelMyBooking(
          env, store, profile, cancelMatch![1], reason,
        );

        ctx.waitUntil(notifyBooking(
          env, store, { ...notify, lineName: profile.displayName }, "cancel",
        ));

        return json({ booking });
      } catch (err) {
        if (err instanceof BookingError) return json({ error: err.message }, err.status);
        if (err instanceof LineAuthError) return json({ error: err.message }, err.status);
        return errorResponse(
          err,
          isCancel ? "取消預約失敗" : isEdit ? "更改預約失敗" : "讀取預約失敗",
        );
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

        // 第二次以後的預約要用既有資料預填表單，所以順便回會員資料。
        // 分成兩支 API 的話，客人端一開頁就得打兩次，多一次來回。
        const store = await getStore(env);
        const member = await getMyProfile(env, store, profile.userId);

        return json({
          lineUserId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl ?? null,
          member,
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

  // ── 排程：送明天的預約提醒 ──────────────────────────
  // cron 每半小時觸發一次（wrangler.jsonc），真正「幾點送」由後台設定，
  // 沒到時間的那幾輪會直接跳過。
  // 這裡沒有對外的 HTTP 入口是刻意的——開一支給人 curl 的網址，
  // 等於任何人都能叫系統重送提醒。本機要測用：
  //   npm run dev:worker -- --test-scheduled
  //   curl "http://localhost:8788/__scheduled?cron=*/30+*+*+*+*"
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sendDailyReminders(env)
        .then((r) => {
          console.log(
            r.skipped
              ? `明日提醒 ${r.date}：略過（${r.skipped}）`
              : `明日提醒 ${r.date}：符合 ${r.found} 筆，送出 ${r.sent}，失敗 ${r.failed}`,
          );
        })
        .catch((err) => {
          // 排程失敗不該整個 Worker 掛掉，記 log 就好
          console.error("明日提醒排程失敗", err);
        }),
    );
  },
} satisfies ExportedHandler<Env>;
