/**
 * 建立預約
 *
 * 客人從 LIFF 送出，Worker 驗過 LINE 身分後才寫入。
 *
 * 分層原則：這裡做的檢查是為了「講人話」，真正的把關在資料庫——
 * 同一天一筆、時段上限都是資料庫層的約束，兩個人同時按送出也擋得住。
 * 所以下面每一項檢查都不能拿掉資料庫那層，只是讓正常情況下的錯誤訊息好看。
 */

import type { Env } from "./index";
import { sb, SupabaseError, timesForDate, type Store } from "./supabase";
import { getAvailability, todayInStore } from "./availability";
import type { LineProfile } from "./line";

/** 舊系統 index.html 的三種預約身分，照搬 */
const BOOKING_TYPES = ["新客體驗", "一般預約", "複檢"];

export class BookingError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

// ───────────────────────────────────────────────────────────
// 電話：沿用舊系統 common.js 的規則
// ───────────────────────────────────────────────────────────
// 這幾行不是裝飾。客人常常從通訊錄或 LINE 訊息直接貼上，
// 會帶全形數字、各種連字號、甚至 +886 開頭。舊系統踩過才長這樣。

export function normalizePhone(phone: string): string {
  return (phone || "")
    // 全形數字轉半形
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248))
    // 全形加號轉半形：舊系統漏了這個，＋886... 會被判定成無效電話
    .replace(/＋/g, "+")
    // 空白、各式連字號、點、全形括號一律當分隔符號清掉
    .replace(/[\s\-‐‑‒–—−ー.．()（）]/g, "")
    // 國際碼寫法轉回本地：+886912345678 → 0912345678
    .replace(/^\+?886/, "0");
}

export function isValidPhone(phone: string): boolean {
  const p = normalizePhone(phone);
  if (!/^0\d+$/.test(p)) return false;
  if (p.startsWith("09")) return p.length === 10;   // 手機固定 10 碼
  return p.length === 9 || p.length === 10;         // 市話含區碼
}

const PHONE_RULE_MSG =
  "電話格式不正確。手機請輸入 09 開頭的 10 碼；市話請含區碼，共 9 或 10 碼。";

// ───────────────────────────────────────────────────────────
// 會員
// ───────────────────────────────────────────────────────────

interface Member {
  id: string;
  line_user_id: string | null;
  name: string;
  phone: string;
  guardian_id: string | null;
}

/**
 * 用 LINE 身分找會員，找不到就建一個。
 *
 * 刻意**不**拿這次填的姓名電話去覆蓋既有會員資料：客人為了幫別人訂而改了
 * 表單上的名字，不該把自己的會員資料改掉。這次填的內容會另外存成預約的快照。
 */
async function findOrCreateMember(
  env: Env,
  store: Store,
  profile: LineProfile,
  name: string,
  phone: string,
): Promise<Member> {
  const found = await sb<Member[]>(
    env,
    `members?store_id=eq.${store.id}` +
      `&line_user_id=eq.${encodeURIComponent(profile.userId)}` +
      `&select=id,line_user_id,name,phone,guardian_id&limit=1`,
  );
  if (found[0]) return found[0];

  const created = await sb<Member[]>(
    env,
    `members?select=id,line_user_id,name,phone,guardian_id`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: store.id,
        line_user_id: profile.userId,
        line_name: profile.displayName,
        name,
        phone,
      }),
    },
  );
  return created[0];
}

/**
 * 通知要發給誰的 LINE。
 *
 * 未成年會員綁了監護人時，發給監護人而不是本人（舊系統的 guardianLineId）。
 * 下單當下就解析好存進預約裡——之後監護人關係改了，不該影響已經送出的通知。
 */
async function resolveNotifyTarget(env: Env, member: Member): Promise<string | null> {
  if (!member.guardian_id) return member.line_user_id;

  const rows = await sb<{ line_user_id: string | null }[]>(
    env,
    `members?id=eq.${member.guardian_id}&select=line_user_id&limit=1`,
  );
  // 監護人沒綁 LINE 就退回本人，總比誰都收不到好
  return rows[0]?.line_user_id ?? member.line_user_id;
}

// ───────────────────────────────────────────────────────────
// 建立預約
// ───────────────────────────────────────────────────────────

export interface BookingInput {
  name?: string;
  name2?: string | null;
  phone?: string;
  type?: string;
  date?: string;
  time?: string;
  remark?: string | null;
}

export async function createBooking(
  env: Env,
  store: Store,
  profile: LineProfile,
  input: BookingInput,
) {
  const name = (input.name ?? "").trim();
  const name2 = (input.name2 ?? "").trim();
  const phoneRaw = (input.phone ?? "").trim();
  const type = (input.type ?? "").trim();
  const date = (input.date ?? "").trim();
  const time = (input.time ?? "").trim();
  const remark = (input.remark ?? "").trim();

  // ── 欄位檢查 ────────────────────────────────────────
  if (!name) throw new BookingError("請填姓名");
  if (!phoneRaw) throw new BookingError("請填聯絡電話");
  if (!isValidPhone(phoneRaw)) throw new BookingError(PHONE_RULE_MSG);
  if (!BOOKING_TYPES.includes(type)) throw new BookingError("請選擇預約身分");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError("請選擇日期");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new BookingError("請選擇時間");

  // 不能訂過去。用店家時區判斷，不是 UTC——台灣時間晚上用 UTC 會算成昨天。
  if (date < todayInStore(store)) throw new BookingError("不能預約已經過去的日期");

  // 時段必須真的在這家店的營業時段裡（擋掉自己拼網址送奇怪時間的情況）
  if (!timesForDate(store, date).includes(time)) {
    throw new BookingError("這個時間不在營業時段內");
  }

  const seats = name2 ? 2 : 1;

  // ── 當天狀況 ────────────────────────────────────────
  const [day] = await getAvailability(env, store, date, date);
  if (!day.isOperating) throw new BookingError("這一天沒有營業");

  const slot = day.slots.find((s) => s.time === time);
  if (!slot) throw new BookingError("這個時段目前不開放預約");
  if (slot.remaining < seats) {
    throw new BookingError(
      seats === 2 ? "這個時段剩下的位子不足兩位" : "這個時段已經額滿了",
    );
  }

  // ── 寫入 ────────────────────────────────────────────
  const phone = normalizePhone(phoneRaw);
  const member = await findOrCreateMember(env, store, profile, name, phone);
  const notify = await resolveNotifyTarget(env, member);

  try {
    const rows = await sb<{ id: string; date: string; start_time: string }[]>(
      env,
      `bookings?select=id,date,start_time`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          store_id: store.id,
          member_id: member.id,
          notify_line_user_id: notify,
          // 下單當下的快照：客人事後改名改電話，不動到歷史單
          name,
          name2: name2 || null,
          phone,
          type,
          date,
          start_time: time,
          remark: remark || null,
          booked_by: "customer",
        }),
      },
    );
    return rows[0];
  } catch (err) {
    throw translateWriteError(err);
  }
}

/**
 * 資料庫擋下來的兩條規則，轉成客人看得懂的話。
 *
 * 上面的檢查已經過了還走到這裡，代表是並行送出——兩個人（或同一個人連點兩下）
 * 同時搶同一格。這時候資料庫是唯一擋得住的一層，訊息一定要對。
 */
function translateWriteError(err: unknown): Error {
  if (!(err instanceof SupabaseError)) return err as Error;

  // 23505：唯一索引衝突 → bookings_one_per_member_per_day
  if (err.code === "23505") {
    return new BookingError("您在這一天已經有一筆預約了，要改時間請先取消原本的預約", 409);
  }
  // 23514：check_slot_capacity() 丟的 slot_full
  if (err.code === "23514" || err.message.includes("slot_full")) {
    return new BookingError("這個時段剛剛被訂走了，請換一個時間", 409);
  }
  return err;
}
