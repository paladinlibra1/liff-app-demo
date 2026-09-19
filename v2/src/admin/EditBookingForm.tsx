import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import type { StatusResult } from "./BookingsTab";

/**
 * 後台改預約的時間或備註。
 *
 * 在這之前店員只能「取消再重建一筆」，客人會連收兩張卡片（先取消、再新增），
 * 而且原本那筆的紀錄就斷了。
 *
 * 跟代客預約一樣走 Worker（`/api/admin/bookings/:id/reschedule`）而不是直接
 * 改 Supabase——推播的 token 只存在 Worker，不經過它客人就收不到「已更改」。
 *
 * 時段一樣跟 `/api/availability` 要，跟客人看到的是同一份資料。
 */

interface Slot {
  time: string;
  remaining: number;
}

export interface EditableBooking {
  id: string;
  date: string;
  /** `HH:MM:SS` */
  start_time: string;
  name: string;
  name2: string | null;
  remark: string | null;
}

/** 今天（Asia/Taipei）。過去的單不給刪，要靠這個判斷 */
function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default function EditBookingForm({
  booking, onSaved, onClose, onCancelBooking, onNoShow,
}: {
  store: Store;
  booking: EditableBooking;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
  /**
   * 「🗑️ 刪除預約」。在日曆檢視點客人只會開這張表單，
   * 沒有這顆按鈕就等於要刪除還得先切回清單。
   * 真正的動作在 BookingsTab（要走 Worker 才發得出 LINE），
   * 失敗訊息要回傳給這裡顯示——不然紅字會落在表單下面、看不到。
   */
  onCancelBooking?: () => Promise<StatusResult>;
  /**
   * 「🚫 客人沒來」。存成已取消（紀錄留著），但完全不發通知。
   * 過去的單也按得下去——那是在補記已經發生的事。
   */
  onNoShow?: () => Promise<StatusResult>;
}) {
  const originalTime = booking.start_time.slice(0, 5);
  /*
   * 過去的預約不刪除（老闆定的規則）：已經發生的事，紀錄要留著。
   * 只看日期，當天的單還是刪得掉——客人沒來是店員當天在處理的事。
   * Worker 也擋著，這裡藏按鈕只是不要讓店員白按一次。
   */
  const isPast = booking.date < todayStr();

  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(originalTime);
  const [remark, setRemark] = useState(booking.remark ?? "");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dayOpen, setDayOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /** 同行第二人佔的位子，算「還原自己」時要用 */
  const seats = booking.name2 ? 2 : 1;

  const loadSlots = useCallback(async () => {
    if (!date) return;
    setSlots(null);
    try {
      const res = await fetch(`/api/availability?from=${date}&to=${date}`);
      const body = await res.json() as { days?: { isOperating: boolean; slots: Slot[] }[] };
      const day = body.days?.[0];
      setDayOpen(Boolean(day?.isOperating));
      setSlots(day?.slots ?? []);
    } catch {
      setErr("讀取時段失敗，請稍後再試");
      setSlots([]);
    }
  }, [date]);

  useEffect(() => { void loadSlots(); }, [loadSlots]);

  // 換到別天就清掉選擇；換回原本那天則回到原本的時段，
  // 免得店員點來點去之後不知道自己現在選的是幾點
  useEffect(() => {
    setTime(date === booking.date ? originalTime : "");
  }, [date, booking.date, originalTime]);

  /**
   * 「剩幾位」是算過所有有效預約的，包含這一筆自己。所以看原本那一格時，
   * 要把自己的位子加回去——不然只想改備註、時間不動，那一格卻顯示額滿、
   * 按鈕還是灰的，店員會以為系統壞了。Worker 端也有同一段還原。
   */
  function remainingFor(s: Slot): number {
    const isOwn = date === booking.date && s.time === originalTime;
    return s.remaining + (isOwn ? seats : 0);
  }

  async function save() {
    if (busy) return;                                  // 防連點
    setErr("");
    if (!date) return setErr("請選日期");
    if (!time) return setErr("請選時段");

    const unchanged =
      date === booking.date &&
      time === originalTime &&
      remark.trim() === (booking.remark ?? "").trim();
    if (unchanged) {
      setErr("沒有任何變更");
      return;
    }

    setBusy(true);
    try {
      // Worker 要用這個 token 確認「你是這家店的後台人員」
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setErr("登入已過期，請重新登入後台");
        return;
      }

      const res = await fetch(`/api/admin/bookings/${booking.id}/reschedule`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ date, time, remark: remark.trim() || null }),
      });

      // Worker 的錯誤一律是 { error: "人看得懂的句子" }，直接顯示
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setErr(body?.error || `更改失敗（${res.status}），請稍後再試`);
      } else {
        await onSaved();
        onClose();
      }
    } catch {
      setErr("連線失敗，請確認網路狀態後再試一次");
    } finally {
      setBusy(false);
    }
  }

  /** 刪除預約／標記沒來：成功的話上層會關掉這張表單，失敗就在按鈕旁邊顯示原因 */
  async function run(action: () => Promise<StatusResult>) {
    if (busy) return;
    setBusy(true); setErr("");
    const res = await action();
    if (res.ok) return;                                // 表單要被關掉了，不用收尾
    if (res.error) setErr(res.error);
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-title">更改預約</div>

      <p className="hint" style={{ marginTop: 0 }}>
        <b>{booking.name2 ? `${booking.name}、${booking.name2}` : booking.name}</b>
        　原本是 {booking.date} {originalTime}
      </p>

      <div className="field">
        <label htmlFor="eb-date">日期</label>
        <input id="eb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>時段</label>
        {slots === null && <div className="skeleton" style={{ height: "3rem" }} />}

        {slots !== null && !dayOpen && (
          <p className="hint">
            這一天沒有營業，所以沒有時段可選。
            要改到這天，請先到「📅 營業日設定」把它設為營業。
          </p>
        )}

        {slots !== null && dayOpen && slots.length === 0 && (
          <p className="hint">這一天的時段全被封鎖或已額滿。</p>
        )}

        {slots !== null && dayOpen && slots.length > 0 && (
          <div className="slots">
            {slots.map((s) => {
              const left = remainingFor(s);
              return (
                <button
                  key={s.time} type="button" className="slot"
                  disabled={left < seats}
                  aria-pressed={time === s.time}
                  onClick={() => setTime(s.time)}
                >
                  {s.time}
                  <span className="left">
                    {left < seats ? "額滿" : `剩 ${left} 位`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="eb-remark">備註（可不填）</label>
        <textarea id="eb-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>

      {err && <div className="msg err">{err}</div>}

      {/*
        三顆並排。名字是老闆定的：關表單叫「取消修改」，
        真正把預約取消掉的那顆叫「刪除預約」——雖然資料庫是存成「已取消」
        （報表的取消率要算），但店員的說法就是刪掉。
      */}
      <div className="chips" style={{ marginTop: "1.125rem" }}>
        <button className="slim" disabled={busy} onClick={save}>
          {busy ? "⏳ 儲存中…" : "✅ 儲存更改"}
        </button>
        <button className="slim ghost" disabled={busy} onClick={onClose}>↩️ 取消修改</button>
        {onNoShow && (
          <button className="slim outline" disabled={busy} onClick={() => void run(onNoShow)}>
            🚫 客人沒來
          </button>
        )}
        {onCancelBooking && !isPast && (
          <button className="slim outline danger" disabled={busy} onClick={() => void run(onCancelBooking)}>
            🗑️ 刪除預約
          </button>
        )}
      </div>

      {isPast && (
        <p className="hint">
          過去的預約不能刪除，紀錄要保留。客人沒來請按「🚫 客人沒來」——
          那筆會變成已取消但紀錄留著，而且不發任何通知。
        </p>
      )}

      <p className="hint">
        存檔後，有綁 LINE 的客人會收到一張「預約已更改」的卡片，上面是新的時間
        （綁了監護人就發給監護人）。電話客不會收到通知，記得自己打給他。
      </p>
    </div>
  );
}
