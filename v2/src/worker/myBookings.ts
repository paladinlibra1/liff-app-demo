/**
 * 客人查自己的預約 / 取消預約
 *
 * 對應舊系統的 my-bookings.html。兩個差別：
 *   1. 取消不再刪資料，改成把 status 標成 cancelled（schema 就是為此設計的）
 *   2. 「這筆是不是你的」由後端判斷。舊系統是前端拿 lineId 去查，
 *      等於相信瀏覽器送什麼就是什麼。
 */

import type { Env } from "./index";
import { sb, type Store } from "./supabase";
import { todayInStore, timeNowInStore, getAvailability } from "./availability";
import { BookingError } from "./bookings";
import { timesForDate } from "./supabase";
import type { LineProfile } from "./line";
import type { NotifyBooking } from "./linePush";

export interface MyBooking {
  id: string;
  date: string;
  /** 已經轉成 `HH:MM` */
  time: string;
  type: string;
  name: string;
  name2: string | null;
  remark: string | null;
  status: string;
}

interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  type: string;
  name: string;
  name2: string | null;
  remark: string | null;
  status: string;
  phone: string;
  member_id: string | null;
  notify_line_user_id: string | null;
}

const FIELDS =
  "id,date,start_time,type,name,name2,phone,remark,status,member_id,notify_line_user_id";

/**
 * 「這個 LINE 使用者看得到哪些預約」的條件。
 *
 * 兩種都算：自己名下的，以及通知發給自己的——後者是監護人的情況，
 * 家長要看得到小孩的預約，不然他收得到通知卻查不到、也取消不了。
 */
async function scopedBookings(
  env: Env,
  store: Store,
  profile: LineProfile,
  extraFilter = "",
): Promise<BookingRow[]> {
  const members = await sb<{ id: string }[]>(
    env,
    `members?store_id=eq.${store.id}` +
      `&line_user_id=eq.${encodeURIComponent(profile.userId)}&select=id&limit=1`,
  );
  const memberId = members[0]?.id;

  const ors = [`notify_line_user_id.eq.${profile.userId}`];
  if (memberId) ors.push(`member_id.eq.${memberId}`);

  return sb<BookingRow[]>(
    env,
    `bookings?store_id=eq.${store.id}` +
      `&or=(${ors.join(",")})` +
      extraFilter +
      `&select=${FIELDS}`,
  );
}

function toMyBooking(r: BookingRow): MyBooking {
  return {
    id: r.id,
    date: r.date,
    time: r.start_time.slice(0, 5),   // PostgREST 回 HH:MM:SS
    type: r.type,
    name: r.name,
    name2: r.name2,
    remark: r.remark,
    status: r.status,
  };
}

/**
 * 我的預約清單。
 *
 * 一併回傳店家時區的「現在」，讓前端用同一個基準切「即將到來 / 已過去」。
 * 少了這個，客人手機時區設錯就會看到分類錯亂的清單。
 */
export async function listMyBookings(env: Env, store: Store, profile: LineProfile) {
  const rows = await scopedBookings(
    env,
    store,
    profile,
    // 取消掉的不列出來，跟舊系統一致（舊系統是直接刪掉所以也看不到）
    "&status=neq.cancelled&order=date.desc,start_time.desc&limit=100",
  );

  return {
    now: { date: todayInStore(store), time: timeNowInStore(store) },
    bookings: rows.map(toMyBooking),
  };
}

/**
 * 改期。
 *
 * 只能改日期、時間、備註。姓名電話是下單當下的快照，改了會讓歷史單
 * 跟著變，那是另一件事；要改人請取消後重訂。
 *
 * 檢查跟新訂一筆完全一樣（營業日、時段、額滿），因為對資料庫來說
 * 這就是把一個位子換到另一個位子。時段上限與每日上限兩個 trigger
 * 在 UPDATE 時也會跑，而且都排除自己那一列，所以原地不動也不會被自己擋。
 */
export async function rescheduleMyBooking(
  env: Env,
  store: Store,
  profile: LineProfile,
  bookingId: string,
  input: { date?: string; time?: string; remark?: string | null },
) {
  const date = (input.date ?? "").trim();
  const time = (input.time ?? "").trim();
  const remark = (input.remark ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError("請選擇日期");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new BookingError("請選擇時間");

  const rows = await scopedBookings(env, store, profile, `&id=eq.${bookingId}`);
  const booking = rows[0];
  if (!booking) throw new BookingError("找不到這筆預約", 404);
  if (booking.status !== "active") throw new BookingError("這筆預約已經取消了", 409);

  const today = todayInStore(store);
  const nowTime = timeNowInStore(store);

  // 已經開始的單不能自己改，跟取消同一條規則
  const started =
    booking.date < today ||
    (booking.date === today && booking.start_time.slice(0, 5) <= nowTime);
  if (started) {
    throw new BookingError("這個時間已經過了，請直接與店家聯絡", 409);
  }

  if (date < today) throw new BookingError("不能改到已經過去的日期");
  if (date === today && time <= nowTime) {
    throw new BookingError("不能改到已經過去的時間");
  }
  if (!timesForDate(store, date).includes(time)) {
    throw new BookingError("這個時間不在營業時段內");
  }

  const [day] = await getAvailability(env, store, date, date);
  if (!day.isOperating) throw new BookingError("這一天沒有營業");

  const slot = day.slots.find((s) => s.time === time);
  if (!slot) throw new BookingError("這個時段目前不開放預約");

  // 剩餘位子是算過「所有有效預約」的，包含這一筆自己。
  // 原地改備註或只改時間但位子沒變時，要把自己還回去才不會誤判額滿。
  const sameSlot = booking.date === date && booking.start_time.slice(0, 5) === time;
  const seats = booking.name2 ? 2 : 1;
  const remaining = slot.remaining + (sameSlot ? seats : 0);
  if (remaining < seats) {
    throw new BookingError(
      seats === 2 ? "這個時段剩下的位子不足兩位" : "這個時段已經額滿了",
      409,
    );
  }

  const updated = await sb<BookingRow[]>(
    env,
    `bookings?id=eq.${bookingId}&select=${FIELDS}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        date,
        start_time: time,
        remark: remark || null,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  const row = updated[0];
  if (!row) throw new BookingError("更改失敗，請稍後再試", 500);

  return {
    booking: toMyBooking(row),
    notify: {
      date: row.date,
      time: row.start_time.slice(0, 5),
      name: row.name,
      name2: row.name2,
      phone: row.phone,
      type: row.type,
      remark: row.remark,
      notifyLineUserId: row.notify_line_user_id,
    } satisfies NotifyBooking,
  };
}

/**
 * 取消一筆預約。
 *
 * 找不到跟不是你的都回同一種結果——不然可以拿這支去試哪些 id 存在。
 */
export async function cancelMyBooking(
  env: Env,
  store: Store,
  profile: LineProfile,
  bookingId: string,
  reason: string | null,
) {
  const rows = await scopedBookings(env, store, profile, `&id=eq.${bookingId}`);
  const booking = rows[0];
  if (!booking) throw new BookingError("找不到這筆預約", 404);

  if (booking.status !== "active") {
    throw new BookingError("這筆預約已經取消過了", 409);
  }

  // 已經開始的預約不能自己取消，請客人直接聯絡店家
  const today = todayInStore(store);
  const nowTime = timeNowInStore(store);
  const started =
    booking.date < today ||
    (booking.date === today && booking.start_time.slice(0, 5) <= nowTime);
  if (started) {
    throw new BookingError("這個時間已經過了，請直接與店家聯絡", 409);
  }

  const updated = await sb<BookingRow[]>(
    env,
    `bookings?id=eq.${bookingId}&select=${FIELDS}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason,
      }),
    },
  );

  const row = updated[0];
  return {
    // 回給客人的：不含 notify_line_user_id，那是內部資訊
    booking: toMyBooking(row),
    // 推播要用的：多了電話與收件人
    notify: {
      date: row.date,
      time: row.start_time.slice(0, 5),
      name: row.name,
      name2: row.name2,
      phone: row.phone,
      type: row.type,
      remark: row.remark,
      notifyLineUserId: row.notify_line_user_id,
    } satisfies NotifyBooking,
  };
}
