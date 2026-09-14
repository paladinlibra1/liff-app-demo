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
import { todayInStore, timeNowInStore } from "./availability";
import { BookingError } from "./bookings";
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
