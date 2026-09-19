import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import NewBookingForm from "./NewBookingForm";
import EditBookingForm from "./EditBookingForm";
import BookingCalendar from "./BookingCalendar";

export interface BookingRow {
  id: string;
  date: string;
  start_time: string;
  name: string;
  name2: string | null;
  phone: string;
  type: string;
  remark: string | null;
  status: string;
  booked_by: string;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayName(date: string): string {
  return "週" + WEEK[new Date(date + "T00:00:00Z").getUTCDay()];
}

const STATUS_LABEL: Record<string, string> = {
  active: "有效",
  completed: "已完成",
  cancelled: "已取消",
};

export default function BookingsTab({ store }: { store: Store }) {
  const today = todayStr();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 30));
  const [showCancelled, setShowCancelled] = useState(false);

  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [err, setErr] = useState("");
  /** 正在改的那一筆 id，同時當防連點的鎖 */
  const [busy, setBusy] = useState<string | null>(null);
  /** 代客預約的表單開著沒 */
  const [adding, setAdding] = useState(false);
  /** 正在改的那一筆，null 就是沒開編輯表單 */
  const [editing, setEditing] = useState<BookingRow | null>(null);
  /** 清單還是日曆。兩邊各自讀自己的資料，篩選條件只屬於清單 */
  const [view, setView] = useState<"list" | "cal">("list");
  /** 存完一筆就 +1，日曆看這個決定要不要重讀 */
  const [stamp, setStamp] = useState(0);

  const load = useCallback(async () => {
    setErr("");
    let q = supabase
      .from("bookings")
      .select("id,date,start_time,name,name2,phone,type,remark,status,booked_by")
      .eq("store_id", store.id)
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("start_time", { ascending: true });

    if (!showCancelled) q = q.neq("status", "cancelled");

    const { data, error } = await q;
    if (error) {
      setErr(error.message);
      return;
    }
    setRows(data as BookingRow[]);
  }, [store.id, from, to, showCancelled]);

  useEffect(() => { void load(); }, [load]);

  /** 存完一筆：清單重讀，日曆也要跟著重讀 */
  const refresh = useCallback(async () => {
    await load();
    setStamp((n) => n + 1);
  }, [load]);

  /**
   * 改狀態走 `/api/admin/bookings/:id/status`，不直接改 Supabase——
   * 店家取消時客人要收到 LINE，而推播的 token 只存在 Worker。
   */
  async function setStatus(row: BookingRow, status: string) {
    if (busy) return;                       // 防連點
    const cancelling = status === "cancelled";
    const verb = cancelling ? "取消" : "標記為已完成";
    const who = `${row.date} ${row.start_time.slice(0, 5)} ${row.name}`;
    const note = cancelling ? "\n\n客人會收到一則取消通知。" : "";
    if (!confirm(`確定要把 ${who} 的預約${verb}嗎？${note}`)) {
      return;
    }

    setBusy(row.id);
    setErr("");
    try {
      // Worker 要用這個 token 確認「你是這家店的後台人員」
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setErr("登入已過期，請重新登入後台");
        return;
      }

      const res = await fetch(`/api/admin/bookings/${row.id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ status }),
      });

      // Worker 的錯誤一律是 { error: "人看得懂的句子" }，直接顯示
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setErr(body?.error || `${verb}失敗（${res.status}），請稍後再試`);
      } else {
        await refresh();
      }
    } catch {
      setErr("連線失敗，請檢查網路後再試一次");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="panel">
        {/* 兩張表單同時開著只會讓人搞不清楚在改哪一筆，開一張就關掉另一張 */}
        <button className="slim" onClick={() => { setEditing(null); setAdding(true); }}>
          ➕ 代客預約
        </button>
        <p className="hint">店家幫客人訂。規則跟客人端一樣，只選得到有營業又還有位子的時段。</p>
      </div>

      {adding && (
        <NewBookingForm
          store={store}
          onSaved={refresh}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <EditBookingForm
          store={store}
          booking={editing}
          onSaved={refresh}
          onClose={() => setEditing(null)}
        />
      )}

      {/* 清單／日曆。日曆是自己刻的（BookingCalendar），不是 Google 日曆的嵌入畫面 */}
      <div className="tabs">
        <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
          📋 清單
        </button>
        <button type="button" aria-pressed={view === "cal"} onClick={() => setView("cal")}>
          📅 日曆
        </button>
      </div>

      {err && <div className="msg err">{err}</div>}

      {view === "cal" && (
        <BookingCalendar
          store={store}
          reloadKey={stamp}
          onPick={(r) => { setAdding(false); setEditing(r); }}
        />
      )}

      {view === "list" && (
        <>
        <div className="panel">
          <div className="filters">
            <div className="f">
              <label htmlFor="from">開始日期</label>
              <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="f">
              <label htmlFor="to">結束日期</label>
              <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="chips">
            <button className="slim outline" onClick={() => { setFrom(today); setTo(today); }}>
              📆 今天
            </button>
            <button className="slim outline" onClick={() => { setFrom(today); setTo(addDays(today, 6)); }}>
              🗓️ 未來 7 天
            </button>
            <button className="slim outline" onClick={() => { setFrom(today); setTo(addDays(today, 30)); }}>
              🗓️ 未來 30 天
            </button>
            <button className="slim outline" onClick={() => { setFrom(addDays(today, -30)); setTo(addDays(today, -1)); }}>
              🕘 過去 30 天
            </button>
          </div>

          <label className="toggle" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => setShowCancelled(e.target.checked)}
            />
            顯示已取消的預約
          </label>
        </div>

        {rows === null && <div className="panel"><div className="skeleton" style={{ height: 64 }} /></div>}

        {rows && rows.length === 0 && (
          <div className="panel empty">
            <div className="emoji">📅</div>
            <p>這段期間沒有預約</p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <>
            <p className="sub" style={{ margin: "0 0 10px" }}>共 {rows.length} 筆</p>
            <div className="rows">
              {rows.map((r) => (
                <div className={"arow" + (r.status === "cancelled" ? " off" : "")} key={r.id}>
                  <div className="c when" data-label="日期">
                    <b>{r.date.slice(5)}</b>
                    <span className="dow">{dayName(r.date)}</span>
                    <span className="tm">{r.start_time.slice(0, 5)}</span>
                  </div>

                  <div className="c who" data-label="客人">
                    <b>{r.name2 ? `${r.name}、${r.name2}` : r.name}</b>
                    {r.name2 && <span className="tag2">兩位</span>}
                    <div className="tel">
                      {/* 手機上點一下就能打過去，店員最常用的動作 */}
                      <a href={`tel:${r.phone}`}>{r.phone}</a>
                    </div>
                  </div>

                  <div className="c" data-label="身分">{r.type}</div>

                  <div className="c" data-label="狀態">
                    <span className={"badge " + (r.status === "active" ? "up" : "old")}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.booked_by === "admin" && <span className="tag2">店家代訂</span>}
                  </div>

                  {r.remark && <div className="c note" data-label="備註">{r.remark}</div>}

                  <div className="c acts">
                    {r.status === "active" && (
                      <>
                        <button className="slim outline" disabled={busy === r.id}
                          onClick={() => { setAdding(false); setEditing(r); }}>
                          ✏️ 改時間
                        </button>
                        <button className="slim outline" disabled={busy === r.id}
                          onClick={() => setStatus(r, "completed")}>
                          ✅ 完成
                        </button>
                        <button className="slim outline danger" disabled={busy === r.id}
                          onClick={() => setStatus(r, "cancelled")}>
                          ❌ 取消
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        </>
      )}
    </>
  );
}
