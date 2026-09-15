import { useEffect, useMemo, useState } from "react";
import {
  fetchStore, fetchMyBookings, cancelBooking,
  type StoreInfo, type MyBooking,
} from "./api";
import { initLiff, type LiffState } from "./liff";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function dateLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（週${WEEK[d.getUTCDay()]}）`;
}

type Tab = "upcoming" | "past";

export default function MyBookingsApp() {
  const [liffState, setLiffState] = useState<LiffState | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [now, setNow] = useState<{ date: string; time: string } | null>(null);
  const [err, setErr] = useState("");

  const [tab, setTab] = useState<Tab>("upcoming");
  /** 正在取消的那一筆 id；同時當作防連點的鎖 */
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchStore().then((s) => !cancelled && setStore(s)).catch(() => { /* 店名拿不到不影響清單 */ });

    initLiff("my").then(async (state) => {
      if (cancelled) return;
      setLiffState(state);
      if (state.kind !== "ready") return;
      try {
        const data = await fetchMyBookings(state.viewer.accessToken);
        if (cancelled) return;
        setBookings(data.bookings);
        setNow(data.now);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    });

    return () => { cancelled = true; };
  }, []);

  /**
   * 用後端給的「店家現在時刻」切，不是手機的時間。
   * 時間剛好等於現在的那一筆算已過去——已經開始了就不該還能取消。
   */
  const [upcoming, past] = useMemo(() => {
    const list = bookings ?? [];
    if (!now) return [list, [] as MyBooking[]];
    const isUpcoming = (b: MyBooking) =>
      b.date > now.date || (b.date === now.date && b.time > now.time);
    return [
      list.filter(isUpcoming).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
      list.filter((b) => !isUpcoming(b)),
    ];
  }, [bookings, now]);

  async function handleCancel(b: MyBooking) {
    if (cancelling) return;                   // 防連點
    if (liffState?.kind !== "ready") return;
    if (!confirm(`確定要取消 ${dateLabel(b.date)} ${b.time} 的預約嗎？\n取消後無法復原。`)) return;

    setCancelling(b.id);
    setErr("");
    try {
      await cancelBooking(liffState.viewer.accessToken, b.id);
      // 取消成功就把它從清單拿掉（後端也不會再回傳這筆）
      setBookings((list) => (list ?? []).filter((x) => x.id !== b.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCancelling(null);
    }
  }

  const list = tab === "upcoming" ? upcoming : past;

  return (
    <div className="wrap narrow">
      <div className="brand">
        <div className="name">{store?.name ?? " "}</div>
        <div className="tag">我的預約</div>
      </div>

      {liffState?.kind === "preview" && (
        <div className="msg note" style={{ marginTop: 0, marginBottom: 14 }}>
          開發預覽模式（{liffState.reason}）。沒有 LINE 身分，查不到預約紀錄。
        </div>
      )}
      {liffState?.kind === "error" && (
        <div className="msg err" style={{ marginTop: 0, marginBottom: 14 }}>
          {liffState.message}
        </div>
      )}

      <div className="tabs">
        <button
          type="button" aria-pressed={tab === "upcoming"}
          onClick={() => setTab("upcoming")}
        >
          📅 即將到來{upcoming.length > 0 && `（${upcoming.length}）`}
        </button>
        <button
          type="button" aria-pressed={tab === "past"}
          onClick={() => setTab("past")}
        >
          🕘 歷史紀錄
        </button>
      </div>

      {err && <div className="msg err">{err}</div>}

      {bookings === null && liffState?.kind === "ready" && (
        <div className="panel"><div className="skeleton" style={{ height: 72 }} /></div>
      )}

      {bookings !== null && list.length === 0 && (
        <div className="panel empty">
          <div className="emoji">{tab === "upcoming" ? "🌸" : "📖"}</div>
          <p>{tab === "upcoming" ? "目前沒有即將到來的預約" : "還沒有歷史預約紀錄"}</p>
          {tab === "upcoming" && (
            <button onClick={() => { window.location.href = "/"; }}>📅 去預約</button>
          )}
        </div>
      )}

      {list.map((b) => (
        <div className="panel bk" key={b.id}>
          <div className="bk-head">
            <div className="bk-when">
              <span className="d">{dateLabel(b.date)}</span>
              <span className="t">{b.time}</span>
            </div>
            <span className={"badge " + (tab === "upcoming" ? "up" : "old")}>
              {tab === "upcoming" ? "即將到來" : "已完成"}
            </span>
          </div>

          <div className="bk-meta">
            {b.type}　·　{b.name2 ? `${b.name}、${b.name2}（兩位）` : b.name}
          </div>

          {b.remark && <div className="bk-remark">📝 {b.remark}</div>}

          {tab === "upcoming" && (
            <button
              className="outline"
              disabled={cancelling === b.id}
              onClick={() => handleCancel(b)}
            >
              {cancelling === b.id ? "⏳ 取消中…" : "❌ 取消預約"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
