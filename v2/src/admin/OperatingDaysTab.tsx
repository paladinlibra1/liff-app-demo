import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

type Kind = "weekday" | "weekend";

interface Hours {
  weekday: string[];
  weekend: string[];
  /** business_hours 是 jsonb 欄位，型別上要能當成一般物件才塞得回去 */
  [key: string]: string[];
}

interface DayRow {
  date: string;
  is_operating: boolean;
  blocked_times: string[];
}

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

/** `2026-09` → 該月每一天的日期字串 */
function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

function dow(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

/** 週六、週日算假日，其餘算平日。跟 Worker 的 timesForDate() 必須一致 */
function kindOf(date: string): Kind {
  const d = dow(date);
  return d === 0 || d === 6 ? "weekend" : "weekday";
}

/** 產生 `開始 ~ 結束` 每隔 n 分鐘的時段 */
function generate(start: string, end: string, stepMin: number): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: string[] = [];
  for (let m = toMin(start); m <= toMin(end); m += stepMin) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

export default function OperatingDaysTab({ store }: { store: Store }) {
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));

  const [hours, setHours] = useState<Hours | null>(null);
  const [days, setDays] = useState<Record<string, DayRow>>({});
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /** 展開中的日期（編輯封鎖時段用） */
  const [openDate, setOpenDate] = useState<string | null>(null);

  // ── 讀取 ──────────────────────────────────────────
  const loadHours = useCallback(async () => {
    const { data, error } = await supabase
      .from("stores").select("business_hours").eq("id", store.id).single();
    if (error) { setErr(error.message); return; }
    const bh = (data.business_hours ?? {}) as Partial<Hours>;
    setHours({ weekday: bh.weekday ?? [], weekend: bh.weekend ?? [] });
  }, [store.id]);

  const loadDays = useCallback(async () => {
    const list = daysOfMonth(month);
    const { data, error } = await supabase
      .from("operating_days")
      .select("date,is_operating,blocked_times")
      .eq("store_id", store.id)
      .gte("date", list[0])
      .lte("date", list[list.length - 1]);
    if (error) { setErr(error.message); return; }
    const map: Record<string, DayRow> = {};
    for (const r of data as DayRow[]) map[r.date] = r;
    setDays(map);
  }, [store.id, month]);

  useEffect(() => { void loadHours(); }, [loadHours]);
  useEffect(() => { void loadDays(); }, [loadDays]);

  // ── 營業時間 ──────────────────────────────────────
  async function saveHours(next: Hours) {
    if (busy) return;                                  // 防連點
    setBusy("hours"); setErr(""); setOk("");

    // ⚠️ 一定要帶 .select()。RLS 擋下來的 UPDATE **不會回錯誤**——
    //    它是把那一列從可更新範圍濾掉，PostgREST 照樣回 204。
    //    只看 error 的話，店員會看到「已儲存」但其實什麼都沒存。
    //    帶 .select() 就能用「有沒有回傳資料列」判斷到底寫進去沒有。
    const { data, error } = await supabase
      .from("stores").update({ business_hours: next }).eq("id", store.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功：只有負責人可以修改營業時間，請聯絡負責人。");
    } else {
      setHours(next);
      setOk("營業時間已儲存");
    }
    setBusy(null);
  }

  function removeTime(kind: Kind, t: string) {
    if (!hours) return;
    void saveHours({ ...hours, [kind]: hours[kind].filter((x) => x !== t) });
  }

  function addTime(kind: Kind, t: string) {
    if (!hours || !t) return;
    if (hours[kind].includes(t)) return;
    void saveHours({ ...hours, [kind]: [...hours[kind], t].sort() });
  }

  // ── 營業日 ────────────────────────────────────────
  async function toggleDay(date: string, isOperating: boolean) {
    if (busy) return;
    setBusy(date); setErr(""); setOk("");
    const row = days[date];
    const { data, error } = await supabase.from("operating_days").upsert({
      store_id: store.id,
      date,
      is_operating: isOperating,
      // 保留原本的封鎖時段，不要因為切換開關就被清掉
      blocked_times: row?.blocked_times ?? [],
    }, { onConflict: "store_id,date" }).select("date");
    if (error) setErr(error.message);
    else if (!data || data.length === 0) setErr("沒有儲存成功，請確認你的帳號權限。");
    else await loadDays();
    setBusy(null);
  }

  async function toggleBlocked(date: string, time: string) {
    if (busy) return;
    setBusy(date); setErr(""); setOk("");
    const row = days[date];
    const current = row?.blocked_times ?? [];
    const next = current.includes(time)
      ? current.filter((t) => t !== time)
      : [...current, time].sort();

    const { data, error } = await supabase.from("operating_days").upsert({
      store_id: store.id,
      date,
      is_operating: row?.is_operating ?? true,
      blocked_times: next,
    }, { onConflict: "store_id,date" }).select("date");
    if (error) setErr(error.message);
    else if (!data || data.length === 0) setErr("沒有儲存成功，請確認你的帳號權限。");
    else await loadDays();
    setBusy(null);
  }

  const monthDays = useMemo(() => daysOfMonth(month), [month]);

  return (
    <>
      {/* ───────── 營業時間 ───────── */}
      <div className="panel">
        <div className="panel-title">營業時間</div>
        <p className="sub" style={{ marginBottom: 16 }}>
          平日（週一～週五）與假日（週六、週日）分開設定。改了之後客人端立刻生效。
          <br />某一天要臨時關掉部分時段，請用下面的「營業日」個別封鎖，不要改這裡。
        </p>

        {hours === null
          ? <div className="skeleton" style={{ height: 80 }} />
          : (["weekday", "weekend"] as Kind[]).map((kind) => (
            <HoursEditor
              key={kind}
              kind={kind}
              times={hours[kind]}
              disabled={busy === "hours"}
              onAdd={(t) => addTime(kind, t)}
              onRemove={(t) => removeTime(kind, t)}
              onReplace={(list) => void saveHours({ ...hours, [kind]: list })}
            />
          ))}
      </div>

      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}

      {/* ───────── 營業日 ───────── */}
      <div className="panel">
        <div className="panel-title">營業日</div>
        <p className="sub" style={{ marginBottom: 14 }}>
          <b>沒有設定的日子一律當作不營業</b>，客人看不到、也約不到。
          要開放哪一天就把它打開。
        </p>
        <div className="filters">
          <div className="f">
            <label htmlFor="month">月份</label>
            <input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rows">
        {monthDays.map((date) => {
          const row = days[date];
          const on = row?.is_operating ?? false;
          const blocked = row?.blocked_times ?? [];
          const times = hours?.[kindOf(date)] ?? [];
          const past = date < today;

          return (
            <div className={"arow day" + (on ? "" : " off") + (past ? " past" : "")} key={date}>
              <div className="c when" data-label="日期">
                <b>{date.slice(5)}</b>
                <span className="dow">週{WEEK[dow(date)]}</span>
                <span className="tag2">{kindOf(date) === "weekend" ? "假日" : "平日"}</span>
              </div>

              <div className="c" data-label="狀態">
                <label className="switch">
                  <input
                    type="checkbox" checked={on} disabled={busy === date}
                    onChange={(e) => toggleDay(date, e.target.checked)}
                  />
                  <span>{on ? "營業" : "休息"}</span>
                </label>
              </div>

              <div className="c" data-label="封鎖時段">
                {on
                  ? (blocked.length > 0 ? `${blocked.length} 個時段不開放` : "全部開放")
                  : "—"}
              </div>

              <div className="c acts">
                {on && times.length > 0 && (
                  <button
                    className="slim outline"
                    onClick={() => setOpenDate(openDate === date ? null : date)}
                  >
                    {openDate === date ? "收合" : "封鎖時段"}
                  </button>
                )}
              </div>

              {openDate === date && on && (
                <div className="c expand">
                  <div className="slots">
                    {times.map((t) => {
                      const isBlocked = blocked.includes(t);
                      return (
                        <button
                          key={t} type="button" className="slot"
                          aria-pressed={isBlocked}
                          disabled={busy === date}
                          onClick={() => toggleBlocked(date, t)}
                        >
                          {t}
                          <span className="left">{isBlocked ? "不開放" : "開放"}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="hint">點一下切換。被封鎖的時段，客人端會顯示「額滿」。</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────

function HoursEditor({
  kind, times, disabled, onAdd, onRemove, onReplace,
}: {
  kind: Kind;
  times: string[];
  disabled: boolean;
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
  onReplace: (list: string[]) => void;
}) {
  const [newTime, setNewTime] = useState("");
  const [genOpen, setGenOpen] = useState(false);
  const [start, setStart] = useState("12:30");
  const [end, setEnd] = useState("19:30");
  const [step, setStep] = useState(30);

  const title = kind === "weekday" ? "平日（週一～週五）" : "假日（週六、週日）";

  return (
    <div className="hours">
      <div className="hours-head">
        <b>{title}</b>
        <span className="sub" style={{ margin: 0 }}>{times.length} 個時段</span>
      </div>

      <div className="chips">
        {times.map((t) => (
          <button
            key={t} className="chip" disabled={disabled}
            onClick={() => onRemove(t)}
            title="點一下刪除這個時段"
          >
            {t} <span className="x">×</span>
          </button>
        ))}
        {times.length === 0 && <span className="hint">還沒有設定時段</span>}
      </div>

      <div className="hours-add">
        <input
          type="time" step={300} value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          disabled={disabled}
        />
        <button
          className="slim" disabled={disabled || !newTime}
          onClick={() => { onAdd(newTime); setNewTime(""); }}
        >
          新增
        </button>
        <button className="slim outline" onClick={() => setGenOpen(!genOpen)}>
          批次產生
        </button>
      </div>

      {genOpen && (
        <div className="gen">
          <p className="hint" style={{ marginTop: 0 }}>
            會<b>取代</b>目前這一組的所有時段，不是附加上去。
          </p>
          <div className="filters">
            <div className="f">
              <label>開始</label>
              <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="f">
              <label>結束</label>
              <input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="f">
              <label>間隔</label>
              <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
                <option value={15}>15 分鐘</option>
                <option value={30}>30 分鐘</option>
                <option value={60}>1 小時</option>
              </select>
            </div>
          </div>
          <button
            className="slim" disabled={disabled}
            onClick={() => {
              const list = generate(start, end, step);
              if (!confirm(`${title}會變成 ${list.length} 個時段（${list[0]} ~ ${list[list.length - 1]}），確定嗎？`)) return;
              onReplace(list);
              setGenOpen(false);
            }}
          >
            產生並儲存
          </button>
        </div>
      )}
    </div>
  );
}
