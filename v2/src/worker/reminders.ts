/**
 * 前一天的預約提醒（排程）
 *
 * 對應舊系統 GAS 的 sendDailyRemindersFirebase()。差別：
 *   1. 不再把整張表撈回來自己比對日期，改成讓資料庫用 index 篩
 *   2. 「已提醒過」用 bookings.reminded_at（timestamptz）而不是布林值，
 *      出問題時看得出來是什麼時候送的
 *
 * 排程由 Cloudflare Cron Triggers 觸發（wrangler.jsonc 的 triggers.crons），
 * 店家不需要做任何設定。
 */

import type { Env } from "./index";
import { sb, getStore, type Store } from "./supabase";
import { todayInStore } from "./availability";
import { notifyReminder, type NotifyBooking } from "./linePush";

/** 一次最多提醒幾筆。單日預約量遠低於此，設上限只是為了不讓意外的資料量把排程跑爆 */
const MAX_PER_RUN = 200;

interface ReminderRow {
  id: string;
  date: string;
  start_time: string;
  name: string;
  name2: string | null;
  phone: string;
  type: string;
  remark: string | null;
  notify_line_user_id: string;
}

/**
 * 店家時區的明天。
 *
 * 一定要以店家時區為準：Cron 是 UTC 觸發的，直接拿 UTC 的日期加一天，
 * 台灣時間晚上 8 點跑就會算成後天，整批提醒全部送錯天。
 */
export function tomorrowInStore(store: Store): string {
  const d = new Date(todayInStore(store) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface ReminderResult {
  date: string;
  /** 符合條件的筆數 */
  found: number;
  sent: number;
  failed: number;
}

/**
 * 送出明天所有還沒提醒過的預約。
 *
 * 條件刻意都放在查詢裡：
 *   - status=active    取消掉的當然不提醒
 *   - reminded_at 是空 重跑排程不會重複轟炸客人
 *   - notify_line_user_id 有值  沒綁 LINE 的推不出去
 */
export async function sendDailyReminders(env: Env): Promise<ReminderResult> {
  const store = await getStore(env);
  const date = tomorrowInStore(store);

  const rows = await sb<ReminderRow[]>(
    env,
    `bookings?store_id=eq.${store.id}` +
      `&date=eq.${date}` +
      `&status=eq.active` +
      `&reminded_at=is.null` +
      `&notify_line_user_id=not.is.null` +
      `&select=id,date,start_time,name,name2,phone,type,remark,notify_line_user_id` +
      `&order=start_time.asc&limit=${MAX_PER_RUN}`,
  );

  let sent = 0;
  let failed = 0;

  for (const r of rows) {
    const booking: NotifyBooking = {
      date: r.date,
      time: r.start_time.slice(0, 5),
      name: r.name,
      name2: r.name2,
      phone: r.phone,
      type: r.type,
      remark: r.remark,
      notifyLineUserId: r.notify_line_user_id,
    };

    const ok = await notifyReminder(env, booking);
    if (!ok) {
      // 沒送出去就不標記。這一輪不會再撈到它（同一批查詢已經拿完了），
      // 但也不會假裝提醒過——店家從 reminded_at 是空的看得出來漏了誰。
      failed++;
      continue;
    }

    try {
      await sb(
        env,
        // 再帶一次 reminded_at=is.null：萬一有另一個執行緒同時在跑，
        // 這裡就不會把別人剛寫進去的時間蓋掉
        `bookings?id=eq.${r.id}&reminded_at=is.null`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ reminded_at: new Date().toISOString() }),
        },
      );
      sent++;
    } catch (err) {
      // 訊息已經送到客人手機了，標記失敗只會讓明天…其實不會有明天，
      // 這筆的日期一過就再也撈不到。記 log 讓人看得到就好。
      console.error("提醒已送出但標記失敗", r.id, err);
      sent++;
    }
  }

  return { date, found: rows.length, sent, failed };
}
