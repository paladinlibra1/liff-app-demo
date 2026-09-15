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
import { normalizePhone, isValidPhone, PHONE_RULE_MSG } from "../shared/phone";
import { birthdayError } from "../shared/birthday";

/** 舊系統 index.html 的三種預約身分，照搬 */
const BOOKING_TYPES = ["新客體驗", "一般預約", "複檢"];

export class BookingError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

// ───────────────────────────────────────────────────────────
// 會員
// ───────────────────────────────────────────────────────────

interface Member {
  id: string;
  line_user_id: string | null;
  name: string;
  phone: string;
  birthday: string | null;
  guardian_id: string | null;
}

/** 回頭客的表單要靠這些欄位預填，不用每次重打 */
export interface MyProfile {
  name: string;
  phone: string;
  birthday: string | null;
}

/**
 * 這個 LINE 身分已經是會員了嗎。
 *
 * 客人端一開頁就問一次，有資料就把姓名、電話、生日先填好。
 * 只回這三個欄位——會員還有備註、介紹人那些，那是店家記的東西，不是客人的。
 */
export async function getMyProfile(
  env: Env,
  store: Store,
  lineUserId: string,
): Promise<MyProfile | null> {
  const rows = await sb<MyProfile[]>(
    env,
    `members?store_id=eq.${store.id}` +
      `&line_user_id=eq.${encodeURIComponent(lineUserId)}` +
      `&select=name,phone,birthday&limit=1`,
  );
  return rows[0] ?? null;
}

/**
 * 用 LINE 身分找會員；找不到就先試著接上店家手動建的那一筆，真的沒有才建新的。
 *
 * 為什麼要「接上」：店家會先幫沒有 LINE 的客人手動建檔（電話客、未成年）。
 * 那個人之後自己從 LINE 訂一次，如果只用 line_user_id 去找，會找不到而另外
 * 建一筆——同一個人變成兩筆資料，一筆有歷史、一筆有通知，報表也對不起來。
 *
 * 比對的規則刻意保守，因為接錯人比多一筆還糟（會把通知發給別人）：
 *   - 只考慮**沒綁過 LINE** 的會員，已經綁了別人的絕對不動
 *   - 只考慮**沒有監護人**的會員：家長常拿自己的電話幫小孩建檔，
 *     那筆是小孩的，不能因為電話一樣就接到家長身上
 *   - 電話相同且**姓名也相同**優先；沒有同名的，只有在候選剛好一筆時才接
 *   - 候選超過一筆又都不同名 → 不猜，直接建新的，讓店家自己去合併
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
  birthday: string,
): Promise<Member> {
  const fields = "id,line_user_id,name,phone,birthday,guardian_id";

  // ── 1) 這個 LINE 身分已經是會員了 ───────────────────
  const found = await sb<Member[]>(
    env,
    `members?store_id=eq.${store.id}` +
      `&line_user_id=eq.${encodeURIComponent(profile.userId)}` +
      `&select=${fields}&limit=1`,
  );
  if (found[0]) return found[0];

  // ── 2) 店家先手動建過這個人嗎 ───────────────────────
  const candidates = await sb<Member[]>(
    env,
    `members?store_id=eq.${store.id}` +
      `&phone=eq.${encodeURIComponent(phone)}` +
      `&line_user_id=is.null&guardian_id=is.null` +
      `&select=${fields}&order=created_at.asc&limit=5`,
  );

  const sameName = candidates.find((m) => m.name.trim() === name.trim());
  const target = sameName ?? (candidates.length === 1 ? candidates[0] : null);

  if (target) {
    // 再帶一次 line_user_id=is.null：兩個人同時送出時，
    // 後到的那個不會把先到的那個綁定蓋掉（回 0 列，走下面的建新）
    const attached = await sb<Member[]>(
      env,
      `members?id=eq.${target.id}&line_user_id=is.null&select=${fields}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          line_user_id: profile.userId,
          line_name: profile.displayName,
          // 店家手動建檔時常常沒問生日，這裡順手補上；
          // 原本就有值的不動，客人填錯不該蓋掉店家記的資料
          ...(target.birthday ? {} : { birthday }),
        }),
      },
    );
    if (attached[0]) return attached[0];
  }

  // ── 3) 真的是新客人 ─────────────────────────────────
  const created = await sb<Member[]>(
    env,
    `members?select=${fields}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: store.id,
        line_user_id: profile.userId,
        line_name: profile.displayName,
        name,
        phone,
        birthday,
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

export interface CreatedBooking {
  id: string;
  date: string;
  start_time: string;
  name: string;
  name2: string | null;
  phone: string;
  type: string;
  remark: string | null;
  notify_line_user_id: string | null;
}

export interface BookingInput {
  name?: string;
  /** `YYYY-MM-DD`。存在會員身上，不是存在預約上 */
  birthday?: string;
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
  const birthday = (input.birthday ?? "").trim();

  // ── 欄位檢查 ────────────────────────────────────────
  if (!name) throw new BookingError("請填姓名");
  if (!phoneRaw) throw new BookingError("請填聯絡電話");
  if (!isValidPhone(phoneRaw)) throw new BookingError(PHONE_RULE_MSG);
  if (!BOOKING_TYPES.includes(type)) throw new BookingError("請選擇預約身分");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError("請選擇日期");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new BookingError("請選擇時間");

  // 生日存在會員身上，回頭客的表單會自動帶出來，所以這裡一律要求有值。
  // 店家要用它做生日優惠與年齡判斷，少一筆就少一個人。
  if (!birthday) throw new BookingError("請填生日");
  const bErr = birthdayError(birthday);
  if (bErr) throw new BookingError(bErr);

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
  const member = await findOrCreateMember(env, store, profile, name, phone, birthday);
  const notify = await resolveNotifyTarget(env, member);

  try {
    // 多選幾個欄位是給推播用的，不是給客人看的——回應只會挑其中幾個
    const rows = await sb<CreatedBooking[]>(
      env,
      `bookings?select=id,date,start_time,name,name2,phone,type,remark,notify_line_user_id`,
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

// ───────────────────────────────────────────────────────────
// 代客預約（店家幫客人訂）
// ───────────────────────────────────────────────────────────

export interface AdminBookingInput extends BookingInput {
  /** 綁到哪位會員。不給就是電話客，沒有會員資料也不會發通知 */
  memberId?: string | null;
}

/**
 * 店家幫客人建立預約。
 *
 * 跟客人自己訂的差別只有三個：
 *   1. 身分是後台帳號，不是 LINE（呼叫端已經驗過了）
 *   2. 會員是店員指定的，不是從 LINE 身分找出來的——所以要自己確認
 *      那位會員真的屬於這家店，不能前端送什麼 id 就照收
 *   3. booked_by 記成 admin
 *
 * 通知對象一律在這裡重新解析，不接受前端送進來的值：
 * 前端能指定「通知發給誰」的話，等於能拿這支 API 發 LINE 給任意使用者。
 */
export async function createAdminBooking(
  env: Env,
  store: Store,
  input: AdminBookingInput,
) {
  const name = (input.name ?? "").trim();
  const name2 = (input.name2 ?? "").trim();
  const phoneRaw = (input.phone ?? "").trim();
  const type = (input.type ?? "").trim();
  const date = (input.date ?? "").trim();
  const time = (input.time ?? "").trim();
  const remark = (input.remark ?? "").trim();
  const memberId = (input.memberId ?? "").trim();

  if (!name) throw new BookingError("請填預約人姓名");
  if (!phoneRaw) throw new BookingError("請填聯絡電話");
  if (!isValidPhone(phoneRaw)) throw new BookingError(PHONE_RULE_MSG);
  if (!BOOKING_TYPES.includes(type)) throw new BookingError("請選擇預約身分");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError("請選擇日期");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new BookingError("請選擇時間");
  if (date < todayInStore(store)) throw new BookingError("不能預約已經過去的日期");
  if (!timesForDate(store, date).includes(time)) {
    throw new BookingError("這個時間不在營業時段內");
  }

  const seats = name2 ? 2 : 1;

  const [day] = await getAvailability(env, store, date, date);
  if (!day.isOperating) {
    throw new BookingError("這一天沒有營業，請先到營業日設定把它打開");
  }
  const slot = day.slots.find((s) => s.time === time);
  if (!slot) throw new BookingError("這個時段目前不開放預約");
  if (slot.remaining < seats) {
    throw new BookingError(
      seats === 2 ? "這個時段剩下的位子不足兩位" : "這個時段已經額滿了",
    );
  }

  // ── 會員與通知對象 ──────────────────────────────────
  let member: Member | null = null;
  if (memberId) {
    // store_id 一定要一起篩：少了它，別家店的會員 id 也查得到
    const rows = await sb<Member[]>(
      env,
      `members?id=eq.${encodeURIComponent(memberId)}&store_id=eq.${store.id}` +
        `&select=id,line_user_id,name,phone,birthday,guardian_id&limit=1`,
    );
    member = rows[0] ?? null;
    if (!member) throw new BookingError("找不到這位會員", 404);
  }

  const notify = member ? await resolveNotifyTarget(env, member) : null;
  const phone = normalizePhone(phoneRaw);

  try {
    const rows = await sb<CreatedBooking[]>(
      env,
      `bookings?select=id,date,start_time,name,name2,phone,type,remark,notify_line_user_id`,
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          store_id: store.id,
          member_id: member?.id ?? null,
          notify_line_user_id: notify,
          name,
          name2: name2 || null,
          phone,
          type,
          date,
          start_time: time,
          remark: remark || null,
          booked_by: "admin",
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
