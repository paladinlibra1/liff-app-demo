import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

interface BookingRow {
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

  async function setStatus(row: BookingRow, status: string) {
    if (busy) return;                       // 防連點
    const verb = status === "cancelled" ? "取消" : "標記為已完成";
    if (!confirm(`確定要把 ${row.date} ${row.start_time.slice(0, 5)} ${row.name} 的預約${verb}嗎？`)) {
      return;
    }

    setBusy(row.id);
    setErr("");
    const patch: { status: string; cancelled_at?: string; cancel_reason?: string } = { status };
    if (status === "cancelled") {
      patch.cancelled_at = new Date().toISOString();
      patch.cancel_reason = "店家取消";
    }

    // 帶 .select()：被 RLS 擋下的 UPDATE 不會回錯誤，只會回 0 列（見 OperatingDaysTab 的說明）
    const { data, error } = await supabase
      .from("bookings").update(patch).eq("id", row.id).select("id");
    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有更新成功，請確認你的帳號權限。");
    } else {
      await load();
    }
    setBusy(null);
  }

  return (
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

      {err && <div className="msg err">{err}</div>}

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
  );
}
