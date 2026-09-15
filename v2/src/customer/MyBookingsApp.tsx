import { useEffect, useMemo, useState } from "react";
import {
  fetchStore, fetchMe, fetchMyBookings, cancelBooking,
  type StoreInfo, type MyBooking, type MyProfile,
} from "./api";
import { initLiff, type LiffState } from "./liff";
import { BOOKING_URL } from "./links";
import RegisterForm from "./RegisterForm";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

function goBooking() {
  window.location.href = BOOKING_URL;
}

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
  /** 會員資料；null ＝ 還沒綁定，要先擋下來綁 */
  const [member, setMember] = useState<MyProfile | null>(null);
  /** 有沒有問過後端「綁了沒」。沒問過之前不能判定成未綁定 */
  const [checked, setChecked] = useState(false);
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
        /*
         * 先問「綁了沒」。還沒綁的人一筆預約也不會有，
         * 但那跟「綁了卻沒有預約」是兩件事，畫面要分得出來——
         * 前者要請他留資料，後者要請他去訂一筆。
         */
        const me = await fetchMe(state.viewer.accessToken);
        if (cancelled) return;
        setMember(me.member);
        setChecked(true);
        if (!me.member) return;      // 沒綁定就不用查預約了

        const data = await fetchMyBookings(state.viewer.accessToken);
        if (cancelled) return;
        setBookings(data.bookings);
        setNow(data.now);
      } catch (e) {
        if (!cancelled) { setErr((e as Error).message); setChecked(true); }
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

      {/*
        * 還沒綁定：整頁換成綁定表單。
        *
        * 不用「清單空的順便提示一下」那種做法——沒綁定的人看到一個空清單
        * 只會以為系統壞了。綁完就地把 member 設起來，接著把預約查回來，
        * 不用整頁重新載入。
        */}
      {checked && liffState?.kind === "ready" && !member && (
        <RegisterForm
          accessToken={liffState.viewer.accessToken}
          onDone={(m) => {
            setMember(m);
            fetchMyBookings(liffState.viewer.accessToken)
              .then((data) => { setBookings(data.bookings); setNow(data.now); })
              .catch((e: Error) => setErr(e.message));
          }}
        />
      )}

      {(!checked || member || liffState?.kind !== "ready") && (
      <>
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

      {/*
        * 獨立一排、佔滿寬度。它不是分頁，是離開這一頁去做下一件事——
        * 擠在分頁列裡既看不出差別，三顆在手機上也排不開。
        */}
      <button className="go-book" onClick={goBooking}>➕ 馬上預約</button>

      {err && <div className="msg err">{err}</div>}

      {bookings === null && liffState?.kind === "ready" && (
        <div className="panel"><div className="skeleton" style={{ height: 72 }} /></div>
      )}

      {bookings !== null && list.length === 0 && (
        <div className="panel empty">
          <div className="emoji">{tab === "upcoming" ? "🌸" : "📖"}</div>
          <p>{tab === "upcoming" ? "目前沒有即將到來的預約" : "還沒有歷史預約紀錄"}</p>
          {tab === "upcoming" && (
            <button onClick={goBooking}>📅 去預約</button>
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
      </>
      )}
    </div>
  );
}
