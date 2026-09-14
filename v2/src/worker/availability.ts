/**
 * 可預約狀況：某段日期裡，哪幾天有開、每個時段還剩幾個位子
 *
 * 客人端的月曆和時段下拉都靠這支。舊系統是前端自己抓整天的預約再比對，
 * 這裡改成後端算完才送出去——客人看不到別人的預約內容，只看得到「剩幾位」。
 */

import type { Env } from "./index";
import { sb, timesForDate, type Store } from "./supabase";

/**
 * 一個時段最多幾個位子。
 *
 * ⚠️ 這個數字同時寫在資料庫的 check_slot_capacity() trigger 裡。
 *    真正的把關在資料庫（兩個人同時送出也擋得住），這裡只是拿來顯示
 *    「還剩幾位」。改上限時兩邊都要改，否則畫面說還有位子、送出卻被擋。
 */
export const SLOT_CAPACITY = 2;

interface OperatingDayRow {
  date: string;
  is_operating: boolean;
  blocked_times: string[];
}

interface BookingRow {
  date: string;
  /** PostgREST 回的 time 會是 `HH:MM:SS` */
  start_time: string;
  seats: number;
}

export interface DayAvailability {
  date: string;
  isOperating: boolean;
  slots: { time: string; remaining: number }[];
}

/** `HH:MM:SS` → `HH:MM`，好跟 business_hours 裡的字串對得起來 */
function hhmm(t: string): string {
  return t.slice(0, 5);
}

/** 店家所在時區的今天（`YYYY-MM-DD`）。不能用 UTC——台灣時間晚上會算成明天。 */
export function todayInStore(store: Store): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: store.timezone || "Asia/Taipei",
  }).format(new Date());
}

/** 把 from～to（含兩端）展開成日期字串 */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export async function getAvailability(
  env: Env,
  store: Store,
  from: string,
  to: string,
): Promise<DayAvailability[]> {
  const dates = dateRange(from, to);

  // 兩支查詢併發：營業日設定、以及該區間所有有效預約佔掉的位子
  const [days, bookings] = await Promise.all([
    sb<OperatingDayRow[]>(
      env,
      `operating_days?store_id=eq.${store.id}` +
        `&date=gte.${from}&date=lte.${to}` +
        `&select=date,is_operating,blocked_times`,
    ),
    sb<BookingRow[]>(
      env,
      `bookings?store_id=eq.${store.id}&status=eq.active` +
        `&date=gte.${from}&date=lte.${to}` +
        `&select=date,start_time,seats`,
    ),
  ]);

  const dayByDate = new Map(days.map((d) => [d.date, d]));

  // `日期 時段` → 已佔用位子數
  const used = new Map<string, number>();
  for (const b of bookings) {
    const key = `${b.date} ${hhmm(b.start_time)}`;
    used.set(key, (used.get(key) ?? 0) + b.seats);
  }

  return dates.map((date) => {
    const row = dayByDate.get(date);

    // 沒有那一列 = 沒開。營業日是「店家逐日開啟」，不是預設全開——
    // 跟舊系統一致，而且漏設定時的後果是客人約不到，不是約到沒人在店裡。
    const isOperating = row?.is_operating ?? false;
    if (!isOperating) {
      return { date, isOperating: false, slots: [] };
    }

    const blocked = new Set(row?.blocked_times ?? []);

    const slots = timesForDate(store, date)
      .filter((time) => !blocked.has(time))
      .map((time) => ({
        time,
        remaining: Math.max(0, SLOT_CAPACITY - (used.get(`${date} ${time}`) ?? 0)),
      }));

    return { date, isOperating: true, slots };
  });
}
