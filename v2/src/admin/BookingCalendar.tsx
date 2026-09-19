import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import type { BookingRow } from "./BookingsTab";

/*
 * 預約日曆（自訂）
 *
 * 舊系統這一塊是 FullCalendar 的 timeGridWeek；這裡自己刻，理由跟
 * OperatingCalendar 一樣：需要的只是「時段 × 日期」的格子，少一個相依套件，
 * 而且尺寸與配色完全照 theme token 走，不用再去蓋別人的 CSS。
 *
 * 時段列（縱軸）來自 stores.business_hours，不是寫死的 10:00~21:00——
 * 兩家店的營業時間不一樣，老闆也可以在「營業日設定」自己改。
 * 落在營業時間外的預約（改過營業時間的舊單）會自己補一列，
 * 不然那筆單在日曆上等於消失了。
 */

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** 跟報表（ReportsTab）同一組類型顏色，兩邊看起來才是同一個系統 */
const TYPE_COLOR: Record<string, string> = {
  一般預約: "#4CAF50",
  新客體驗: "#f6c026",
  複檢: "#29b6f6",
};
/** 黃底配白字看不清楚，只有這一色用深字 */
const TYPE_INK: Record<string, string> = { 新客體驗: "#3a2d00" };

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dow(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

/** 那一週的星期日。跟 OperatingCalendar 一樣以週日為一週之始 */
function weekStart(date: string): string {
  return addDays(date, -dow(date));
}

/** `2026-09-20` 往前／往後 n 個月，回那個月的一號 */
function shiftMonth(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** 那個月的每一天 */
function daysOfMonth(date: string): string[] {
  const month = date.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 週六、週日算假日，其餘算平日。跟 Worker 的 timesForDate() 必須一致 */
function kindOf(date: string): "weekday" | "weekend" {
  const d = dow(date);
  return d === 0 || d === 6 ? "weekend" : "weekday";
}

interface DayRow {
  date: string;
  is_operating: boolean;
  blocked_times: string[];
}

type View = "month" | "week" | "day";

export default function BookingCalendar({
  store, reloadKey, onPick,
}: {
  store: Store;
  /** 外面存完一筆就 +1，日曆跟著重讀 */
  reloadKey: number;
  onPick: (row: BookingRow) => void;
}) {
  const today = todayStr();
  // 手機一次塞七欄會爆版（窄螢幕不靠橫向捲動），所以小螢幕預設看一天
  const [view, setView] = useState<View>(
    typeof window !== "undefined" && window.innerWidth < 820 ? "day" : "week",
  );
  const [anchor, setAnchor] = useState(today);

  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [days, setDays] = useState<Record<string, DayRow>>({});
  const [hours, setHours] = useState<{ weekday: string[]; weekend: string[] } | null>(null);
  const [err, setErr] = useState("");

  /** 畫面上這幾天 */
  const dates = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "month") return daysOfMonth(anchor);
    const s = weekStart(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [view, anchor]);

  const from = dates[0];
  const to = dates[dates.length - 1];

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("stores")
      .select("business_hours")
      .eq("id", store.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setErr(error.message); return; }
        const bh = (data.business_hours ?? {}) as { weekday?: string[]; weekend?: string[] };
        setHours({ weekday: bh.weekday ?? [], weekend: bh.weekend ?? [] });
      });
    return () => { cancelled = true; };
  }, [store.id]);

  const load = useCallback(async () => {
    setErr("");
    // 取消的單不畫進日曆：格子就那麼大，畫了反而看不出當天實際有幾組客人。
    // 要看取消的單請用「📋 清單」那邊的「顯示已取消的預約」。
    const [b, d] = await Promise.all([
      supabase
        .from("bookings")
        .select("id,date,start_time,name,name2,phone,type,remark,status,booked_by")
        .eq("store_id", store.id)
        .gte("date", from)
        .lte("date", to)
        .neq("status", "cancelled")
        .order("start_time", { ascending: true }),
      supabase
        .from("operating_days")
        .select("date,is_operating,blocked_times")
        .eq("store_id", store.id)
        .gte("date", from)
        .lte("date", to),
    ]);

    if (b.error) { setErr(b.error.message); return; }
    if (d.error) { setErr(d.error.message); return; }

    setRows(b.data as BookingRow[]);
    const map: Record<string, DayRow> = {};
    for (const r of d.data as DayRow[]) map[r.date] = r;
    setDays(map);
  }, [store.id, from, to]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  /** 時段列：這幾天用到的營業時段，再聯集上落在時段外的預約時間 */
  const slots = useMemo(() => {
    const set = new Set<string>();
    if (hours) {
      for (const dt of dates) for (const t of hours[kindOf(dt)]) set.add(t.slice(0, 5));
    }
    for (const r of rows ?? []) set.add(r.start_time.slice(0, 5));
    return [...set].sort();
  }, [hours, dates, rows]);

  /** `日期 時間` → 那一格的預約 */
  const cells = useMemo(() => {
    const map: Record<string, BookingRow[]> = {};
    for (const r of rows ?? []) {
      const k = r.date + " " + r.start_time.slice(0, 5);
      (map[k] ||= []).push(r);
    }
    return map;
  }, [rows]);

  /** 一月檢視用：日期 → 那一天的預約（已照時間排好） */
  const byDate = useMemo(() => {
    const map: Record<string, BookingRow[]> = {};
    for (const r of rows ?? []) (map[r.date] ||= []).push(r);
    return map;
  }, [rows]);

  /** 一月檢視的月曆要補開頭的空格，才對得上星期 */
  const lead = view === "month" ? dow(dates[0]) : 0;

  function shift(n: number) {
    if (view === "month") setAnchor(shiftMonth(anchor, n));
    else setAnchor(addDays(anchor, n * (view === "day" ? 1 : 7)));
  }
  const title = view === "day"
    ? `${anchor.slice(5).replace("-", "/")}（週${WEEK[dow(anchor)]}）`
    : view === "month"
      ? `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(5, 7))} 月`
      : `${from.slice(5).replace("-", "/")} ~ ${to.slice(5).replace("-", "/")}`;

  /**
   * 一筆預約的色塊，**一個人一塊**。
   *
   * 帶同行者的單佔兩個位子（`bookings.seats` = 2，額滿計算看的是這個），
   * 所以畫成兩塊，一格滿了就是滿滿兩塊——跟舊系統的日曆一樣。
   * 兩塊都連到同一筆，點哪一塊都是開那筆的「更改預約」。
   */
  function chips(r: BookingRow, withTime = false) {
    const style = {
      background: TYPE_COLOR[r.type] ?? "var(--rose)",
      color: TYPE_INK[r.type] ?? "#fff",
    };
    const cls = "bchip" + (r.status === "completed" ? " done" : "");
    const tip = `${r.type}／${r.phone}${r.remark ? "／" + r.remark : ""}`;

    const one = (key: string, who: string, note: string) => (
      <button key={key} type="button" className={cls} style={style}
        title={note ? `${who}（${note}）／${tip}` : `${who}／${tip}`}
        onClick={() => onPick(r)}>
        {withTime && <i>{r.start_time.slice(0, 5)}</i>}
        {who}
      </button>
    );

    if (!r.name2) return [one(r.id, r.name, "")];
    return [
      one(r.id, r.name, `同行 2 位，另一位是 ${r.name2}`),
      one(r.id + "-2", r.name2, `同行 2 位，跟 ${r.name} 同一筆`),
    ];
  }

  return (
    <div className="panel">
      <div className="cal-bar">
        <button className="slim outline" onClick={() => shift(-1)}>◀</button>
        <button className="slim outline" onClick={() => shift(1)}>▶</button>
        <b>{title}</b>
        <button className="slim outline" style={{ marginLeft: "auto" }} onClick={() => setAnchor(today)}>
          今天
        </button>
      </div>

      <div className="tabs" style={{ marginBottom: "0.75rem" }}>
        <button type="button" aria-pressed={view === "day"} onClick={() => setView("day")}>
          日
        </button>
        <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
          週
        </button>
        <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>
          月
        </button>
      </div>

      {err && <div className="msg err">{err}</div>}

      {rows === null && <div className="skeleton" style={{ height: 240 }} />}

      {rows !== null && view !== "month" && slots.length === 0 && (
        <div className="empty">
          <div className="emoji">📅</div>
          <p>這幾天沒有營業時段，請先到「📅 營業日設定」設定營業時間</p>
        </div>
      )}

      {rows !== null && view === "month" && (
        <div className="bcal-month">
          {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={"b" + i} className="bmday blank" />)}
          {dates.map((dt) => {
            const on = days[dt]?.is_operating ?? false;
            const list = byDate[dt] ?? [];
            const cls = [
              "bmday",
              on ? "" : "closed",
              dt === today ? "today" : "",
              dt < today ? "past" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={dt} className={cls}>
                {/* 點日期跳到那一天的檢視——手機上月曆的格子太小，看細節要換檢視 */}
                <button type="button" className="bmd-n" title="看這一天"
                  onClick={() => { setAnchor(dt); setView("day"); }}>
                  {Number(dt.slice(8))}
                  {list.length > 0 && <span className="bmd-c">{list.length}</span>}
                </button>
                {list.map((r) => chips(r, true))}
              </div>
            );
          })}
        </div>
      )}

      {rows !== null && view !== "month" && slots.length > 0 && (
        <>
          <div
            className={"bcal " + view}
            style={{ gridTemplateColumns: `3.4rem repeat(${dates.length}, minmax(0, 1fr))` }}
          >
            <div className="bcal-corner" />
            {dates.map((dt) => {
              const on = days[dt]?.is_operating ?? false;
              return (
                <div key={dt} className={"bcal-dh" + (dt === today ? " today" : "") + (on ? "" : " off")}>
                  <b>週{WEEK[dow(dt)]}</b>
                  <span>{dt.slice(5).replace("-", "/")}</span>
                  {!on && <em>休</em>}
                </div>
              );
            })}

            {slots.map((t) => (
              // display:contents → 一列的格子直接落在外層 grid 上，欄位才對得齊
              <div key={t} style={{ display: "contents" }}>
                <div className="bcal-t">{t}</div>
                {dates.map((dt) => {
                  const day = days[dt];
                  const on = day?.is_operating ?? false;
                  const blocked = (day?.blocked_times ?? []).some((x) => x.slice(0, 5) === t);
                  const list = cells[dt + " " + t] ?? [];
                  const cls = [
                    "bcal-cell",
                    on ? "" : "closed",
                    blocked ? "blocked" : "",
                    dt === today ? "today" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <div key={dt + t} className={cls}>
                      {blocked && list.length === 0 && <span className="bcal-x">封</span>}
                      {list.map((r) => chips(r))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="bcal-legend">
            {Object.entries(TYPE_COLOR).map(([type, color]) => (
              <span key={type}><i style={{ background: color }} />{type}</span>
            ))}
            <span className="sub" style={{ margin: 0 }}>
              共 {rows.length} 筆 / {rows.reduce((n, r) => n + (r.name2 ? 2 : 1), 0)} 位・點名字可以改時間
            </span>
          </div>
        </>
      )}
    </div>
  );
}
