/**
 * 客人端打 Worker 的 API
 *
 * 客人不直連 Supabase，一律走 /api。前後端同源，所以不用處理 CORS，
 * 也不需要舊系統那招「Content-Type: text/plain 避開 preflight」。
 */

export interface StoreInfo {
  name: string;
  timezone: string;
  businessHours: { weekday: string[]; weekend: string[] };
}

export interface Slot {
  time: string;
  remaining: number;
}

export interface DayAvailability {
  date: string;
  isOperating: boolean;
  slots: Slot[];
}

export interface BookingDraft {
  name: string;
  /** `YYYY-MM-DD`。存到會員身上，下次來就自動帶出來 */
  birthday: string;
  name2?: string | null;
  phone: string;
  type: string;
  date: string;
  time: string;
  remark?: string | null;
}

/**
 * 統一處理回應。
 *
 * Worker 的錯誤一律是 `{ error: "人看得懂的句子" }`，直接拿來顯示；
 * 真的爆掉（例如回了 HTML）才用通用訊息，不要把一整頁原始碼丟給客人看。
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("連線失敗，請確認網路狀態後再試一次");
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* 不是 JSON，下面用狀態碼判斷 */
  }

  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new Error(msg || `發生錯誤（${res.status}），請稍後再試`);
  }
  return body as T;
}

export const fetchStore = () => request<StoreInfo>("/api/store");

export interface MyProfile {
  name: string;
  phone: string;
  birthday: string | null;
}

/**
 * 我是誰 ＋ 我的會員資料。
 *
 * `member` 是 null 就代表第一次來（或還沒留過資料），表單一律留空；
 * 有值就拿來預填，回頭客不用每次重打姓名電話生日。
 */
export const fetchMe = (accessToken: string) =>
  request<{
    lineUserId: string;
    displayName: string;
    pictureUrl: string | null;
    member: MyProfile | null;
  }>("/api/auth/me", {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken },
  });

export const fetchAvailability = () =>
  request<{ from: string; to: string; days: DayAvailability[] }>("/api/availability");

export interface MyBooking {
  id: string;
  date: string;
  time: string;
  type: string;
  name: string;
  name2: string | null;
  remark: string | null;
  status: string;
}

/**
 * 我的預約。
 *
 * `now` 是**店家時區**的現在時刻，用它來切「即將到來／已過去」——
 * 不要用手機自己的時間，客人時區設錯就會看到分類錯亂的清單。
 */
export const fetchMyBookings = (accessToken: string) =>
  request<{ now: { date: string; time: string }; bookings: MyBooking[] }>(
    "/api/my-bookings",
    { headers: { Authorization: "Bearer " + accessToken } },
  );

export const cancelBooking = (accessToken: string, id: string) =>
  request<{ booking: MyBooking }>(`/api/bookings/${id}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify({}),
  });

export const submitBooking = (accessToken: string, draft: BookingDraft) =>
  request<{ booking: { id: string; date: string; start_time: string } }>("/api/bookings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + accessToken,
    },
    body: JSON.stringify(draft),
  });
