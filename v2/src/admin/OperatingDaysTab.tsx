import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import OperatingCalendar, { type DayState } from "./OperatingCalendar";

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

/** `2026-09` 往前／往後 n 個月 */
function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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

/** 提醒時間的選項：整點與半點。資料庫的 check 也只接受這兩種 */
const REMINDER_CHOICES = generate("08:00", "22:00", 30);

interface Reminder {
  enabled: boolean;
  /** `HH:MM` */
  time: string;
}

export default function OperatingDaysTab({ store }: { store: Store }) {
  const today = todayStr();
  const [month, setMonth] = useState(today.slice(0, 7));

  const [hours, setHours] = useState<Hours | null>(null);
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [days, setDays] = useState<Record<string, DayRow>>({});
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /** 打開封鎖時段面板的那一天 */
  const [openDate, setOpenDate] = useState<string | null>(null);
  /** 批次選取中的日期（照舊系統：跳著點多天，再一次設定） */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── 讀取 ──────────────────────────────────────────
  const loadHours = useCallback(async () => {
    const { data, error } = await supabase
      .from("stores")
      .select("business_hours,reminder_enabled,reminder_time")
      .eq("id", store.id).single();
    if (error) { setErr(error.message); return; }
    const bh = (data.business_hours ?? {}) as Partial<Hours>;
    setHours({ weekday: bh.weekday ?? [], weekend: bh.weekend ?? [] });
    setReminder({
      enabled: data.reminder_enabled,
      // 資料庫回的是 HH:MM:SS
      time: data.reminder_time.slice(0, 5),
    });
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

  // ── 前一天的提醒 ──────────────────────────────────
  // 排程每半小時跑一次，靠這兩個欄位決定那一輪要不要送，
  // 所以改完不用重新部署，下一輪就是新設定。
  async function saveReminder(next: Reminder) {
    if (busy) return;                                  // 防連點
    setBusy("reminder"); setErr(""); setOk("");

    // 跟營業時間一樣要帶 .select()：RLS 擋下的 UPDATE 不會回錯誤
    const { data, error } = await supabase
      .from("stores")
      .update({ reminder_enabled: next.enabled, reminder_time: next.time })
      .eq("id", store.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功：只有負責人可以修改提醒設定，請聯絡負責人。");
    } else {
      setReminder(next);
      setOk(next.enabled ? `提醒時間已設為 ${next.time}` : "已關閉前一天的提醒");
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

  /** 月曆要的：日期 → 是否營業、封鎖幾個 */
  const calState = useMemo(() => {
    const out: Record<string, DayState> = {};
    for (const [date, r] of Object.entries(days)) {
      out[date] = { isOperating: r.is_operating, blockedCount: r.blocked_times.length };
    }
    return out;
  }, [days]);

  /** 剛好選了一天、而且那天有營業 → 才給「封鎖時段」按鈕 */
  const onlyOperatingPick = useMemo(() => {
    if (selected.size !== 1) return null;
    const [d] = [...selected];
    return days[d]?.is_operating ? d : null;
  }, [selected, days]);

  /**
   * 點一格 = 加入／移除選取。
   *
   * 已經設為營業的日子也能選——不然排錯了就取消不掉，只能一天天改。
   * 封鎖時段改成「剛好選一天、而且那天有營業」時才出現按鈕，
   * 因為封鎖本來就是針對單一天的細部設定，跟批次是兩件事。
   */
  function pick(date: string) {
    setOpenDate(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  }

  /** 選取的日子一次設定。一個請求送完，不是一天一筆 */
  async function applyBatch(isOperating: boolean) {
    if (busy) return;                                  // 防連點
    const dates = [...selected].sort();
    if (!confirm(`確定要把選取的 ${dates.length} 天全部設為${isOperating ? "營業" : "店休"}嗎？`)) return;

    setBusy("batch"); setErr(""); setOk("");
    const rows = dates.map((date) => ({
      store_id: store.id,
      date,
      is_operating: isOperating,
      // 保留原本的封鎖時段，不要因為批次設定就被清掉
      blocked_times: days[date]?.blocked_times ?? [],
    }));

    const { data, error } = await supabase
      .from("operating_days").upsert(rows, { onConflict: "store_id,date" }).select("date");

    if (error) setErr(error.message);
    else if (!data || data.length === 0) setErr("沒有儲存成功，請確認你的帳號權限。");
    else {
      setSelected(new Set());
      setOk(`已把 ${dates.length} 天設為${isOperating ? "營業" : "店休"}`);
      await loadDays();
    }
    setBusy(null);
  }

  return (
    <div className="cols">
      <div>
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

      {/* ───────── 預約提醒 ───────── */}
      <div className="panel">
        <div className="panel-title">預約提醒</div>
        <p className="sub" style={{ marginBottom: 16 }}>
          預約的<b>前一天</b>自動用 LINE 提醒客人，每位客人每筆預約只會收到一次。
          <br />沒有綁定 LINE 的預約不會發送。
        </p>

        {reminder === null
          ? <div className="skeleton" style={{ height: 60 }} />
          : (
            <div className="hours">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={reminder.enabled}
                  disabled={busy !== null}
                  onChange={(e) => void saveReminder({ ...reminder, enabled: e.target.checked })}
                />
                <span>開啟前一天的提醒</span>
              </label>

              <div className="hours-add" style={{ marginTop: 12 }}>
                <label className="sub" style={{ margin: 0 }}>發送時間</label>
                <select
                  value={reminder.time}
                  disabled={busy !== null || !reminder.enabled}
                  onChange={(e) => void saveReminder({ ...reminder, time: e.target.value })}
                >
                  {REMINDER_CHOICES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <p className="hint">
                只能設整點或半點——排程每半小時檢查一次，設 20:15 也要等到 20:30 才送得出去。
              </p>
            </div>
          )}
      </div>

      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}
      </div>

      <div>
      {/* ───────── 營業日 ───────── */}
      <div className="panel">
        <div className="panel-title">營業日</div>
        <p className="sub" style={{ marginBottom: 14 }}>
          <b>沒有設定的日子一律當作不營業</b>，客人看不到、也約不到。
          <br />點日期可以連續選很多天（跳著點也行），選好之後一次設為營業或店休。
          <br />已經設為營業的日子一樣可以選起來改回店休。
          <br />只選一天、而且那天有營業時，會多出「封鎖時段」可以關掉個別時段。
        </p>

        <div className="cal-bar">
          <button className="slim outline" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <b>{month.replace("-", " 年 ")} 月</b>
          <button className="slim outline" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
          <button className="slim ghost" onClick={() => setMonth(today.slice(0, 7))}>📆 本月</button>
        </div>

        <OperatingCalendar
          month={month}
          today={today}
          state={calState}
          selected={selected}
          onPick={pick}
        />

        {selected.size > 0 && (
          <div className="batch">
            <span>已選 {selected.size} 天</span>
            <div className="batch-btns">
              <button className="slim" disabled={busy !== null}
                onClick={() => applyBatch(true)}>✅ 設為營業</button>
              <button className="slim outline danger" disabled={busy !== null}
                onClick={() => applyBatch(false)}>🚫 設為店休</button>
              {onlyOperatingPick && (
                <button className="slim outline"
                  onClick={() => { setOpenDate(onlyOperatingPick); setSelected(new Set()); }}>
                  ⛔ 封鎖時段
                </button>
              )}
              <button className="slim ghost" onClick={() => setSelected(new Set())}>✖️ 取消選擇</button>
            </div>
          </div>
        )}
      </div>

      {openDate && (
        <div className="panel">
          <div className="panel-title">封鎖時段 — {openDate}</div>
          {(() => {
            const times = hours?.[kindOf(openDate)] ?? [];
            const blocked = days[openDate]?.blocked_times ?? [];
            if (times.length === 0) {
              return <p className="hint">這一天適用的營業時間還沒設定，請先在上面設定。</p>;
            }
            return (
              <>
                <div className="slots">
                  {times.map((t) => (
                    <button
                      key={t} type="button" className="slot"
                      aria-pressed={blocked.includes(t)}
                      disabled={busy === openDate}
                      onClick={() => toggleBlocked(openDate, t)}
                    >
                      {t}
                      <span className="left">{blocked.includes(t) ? "不開放" : "開放"}</span>
                    </button>
                  ))}
                </div>
                <p className="hint">點一下切換。被封鎖的時段，客人端會顯示「額滿」。</p>
                <button className="ghost" onClick={() => setOpenDate(null)}>✖️ 關閉</button>
              </>
            );
          })()}
        </div>
      )}
      </div>
    </div>
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
          ➕ 新增
        </button>
        <button className="slim outline" onClick={() => setGenOpen(!genOpen)}>
          ⚙️ 批次產生
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
            💾 產生並儲存
          </button>
        </div>
      )}
    </div>
  );
}
