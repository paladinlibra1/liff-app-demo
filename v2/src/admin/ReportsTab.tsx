import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import TrendChart, { type Bucket } from "./TrendChart";
import Heatmap from "./Heatmap";
import RateTrend, { type RatePoint } from "./RateTrend";
import RetentionPanel, { type MemberRow } from "./RetentionPanel";

/**
 * 報表
 *
 * 搬自舊系統 admin.html 的「📊 報表」。算法刻意跟舊版一致，
 * 兩家店的數字才比得起來：
 *
 * - 來客數算的是「沒取消」的預約（active + completed），未來已排的也算進當期
 * - 取消率不看類型篩選，含複檢
 * - 新客轉換率不看類型篩選：分母是本期第一次做新客體驗、而且已經滿 30 天的人，
 *   分子是其中之後有一般預約的人，用電話認人
 * - 自己人不算：會員有設身分（店家／助理／夥伴）的、姓名含「卡」的都排除
 *
 * 資料量是一家店的全部預約，一次撈回來在前端算。
 * 舊系統也是這樣做，幾千筆以內都不會慢；真的變大再改成資料庫彙總。
 */

type Period = "week" | "month" | "year";

interface Row {
  date: string;
  start_time: string;
  type: string;
  status: string;
  name: string;
  phone: string;
  member_id: string | null;
}

const TYPES = ["一般預約", "新客體驗", "複檢"];
const TYPE_COLORS: Record<string, string> = {
  一般預約: "#4CAF50",
  新客體驗: "#f6c026",
  複檢: "#29b6f6",
};

/** 剛體驗完、還來不及回訪的新客不列入轉換率分母，免得一直低估 */
const CONVERSION_MATURE_DAYS = 30;

/** PostgREST 預設一次最多回 1000 列，超過要自己分頁 */
const PAGE = 1000;

// ── 日期：一律用 YYYY-MM-DD 字串＋UTC 運算，不會被瀏覽器時區影響 ──

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00Z");
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 當週（一～日）／當月／當年的起訖日 */
function periodRange(period: Period, anchor: string): { start: string; end: string } {
  const d = toDate(anchor);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (period === "week") {
    const dow = d.getUTCDay();                      // 0=日
    const start = new Date(Date.UTC(y, m, d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { start: fmt(start), end: fmt(end) };
  }
  if (period === "month") {
    return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 0))) };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/** 往前／往後移一期 */
function shift(period: Period, anchor: string, dir: number): string {
  const d = toDate(anchor);
  if (period === "week") d.setUTCDate(d.getUTCDate() + dir * 7);
  // 月、年都先對齊到 1 號，避免 1/31 往後一個月變成 3/3
  else if (period === "month") { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + dir); }
  else { d.setUTCDate(1); d.setUTCFullYear(d.getUTCFullYear() + dir); }
  return fmt(d);
}

function periodLabel(period: Period, start: string, end: string): string {
  const s = toDate(start);
  const e = toDate(end);
  if (period === "week") {
    const f = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
    return `${s.getUTCFullYear()}/${f(s)} － ${f(e)}`;
  }
  if (period === "month") return `${s.getUTCFullYear()} 年 ${s.getUTCMonth() + 1} 月`;
  return `${s.getUTCFullYear()} 年`;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 趨勢圖的格子：年是 12 個月，週／月是每一天。
 * 每一格先把勾選的類型都補 0，沒有預約的日子才畫得出空位。
 */
function buildBuckets(period: Period, start: string, end: string, types: string[], rows: Row[]): Bucket[] {
  const zero = () => Object.fromEntries(types.map((t) => [t, 0]));
  const keyOf: (date: string) => string = period === "year" ? (d) => d.slice(5, 7) : (d) => d;

  const buckets: Bucket[] = [];
  const index = new Map<string, Bucket>();
  if (period === "year") {
    for (let m = 1; m <= 12; m++) {
      const b: Bucket = { label: `${m}月`, ...zero() };
      buckets.push(b);
      index.set(String(m).padStart(2, "0"), b);
    }
  } else {
    for (let d = toDate(start); fmt(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const label = period === "week"
        ? `${WEEK[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`
        : `${d.getUTCDate()}`;
      const b: Bucket = { label, ...zero() };
      buckets.push(b);
      index.set(fmt(d), b);
    }
  }

  for (const r of rows) {
    const b = index.get(keyOf(r.date));
    if (b && r.type in b) b[r.type] = (b[r.type] as number) + 1;
  }
  return buckets;
}

/**
 * 新客轉換的底稿：每支電話第一次做新客體驗是哪天、之後有沒有一般預約。
 * 統計卡和近 12 個月月線都用這份，兩邊數字才對得起來。
 * 還沒滿 CONVERSION_MATURE_DAYS 天的不放進來。
 */
function trialOutcomes(visits: Row[]): { date: string; converted: boolean }[] {
  const matureBefore = fmt(new Date(toDate(todayStr()).getTime() - CONVERSION_MATURE_DAYS * 86400000));
  const firstTrial = new Map<string, string>();
  const lastGeneral = new Map<string, string>();
  for (const r of visits) {
    const p = digits(r.phone);
    if (!p) continue;
    if (r.type === "新客體驗") {
      const cur = firstTrial.get(p);
      if (!cur || r.date < cur) firstTrial.set(p, r.date);
    } else if (r.type === "一般預約") {
      const cur = lastGeneral.get(p);
      if (!cur || r.date > cur) lastGeneral.set(p, r.date);
    }
  }
  return [...firstTrial]
    .filter(([, d]) => d <= matureBefore)
    // 體驗「之後」的一般預約才算，同一天的不算；最晚那筆比體驗晚就代表有
    .map(([p, d]) => ({ date: d, converted: (lastGeneral.get(p) ?? "") > d }));
}

/** 比率類指標逐日算分母太小、線會亂跳，所以固定看最近 12 個月，不跟著上面的期間切換 */
const RATE_MONTHS = 12;

function rateTrend(rows: Row[], trials: { date: string; converted: boolean }[]): RatePoint[] {
  const [y, m] = todayStr().split("-").map(Number);
  const points: RatePoint[] = [];
  const index = new Map<string, { p: RatePoint; booked: number; cancelled: number; t: number; c: number }>();
  for (let i = RATE_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = fmt(d).slice(0, 7);
    const p: RatePoint = {
      label: `${d.getUTCFullYear() % 100}/${d.getUTCMonth() + 1}`,
      cancelRate: null, convRate: null, cancelNote: "", convNote: "",
    };
    points.push(p);
    index.set(key, { p, booked: 0, cancelled: 0, t: 0, c: 0 });
  }

  // 取消率：跟統計卡同一套，所有類型、含複檢
  for (const r of rows) {
    const b = index.get(r.date.slice(0, 7));
    if (!b) continue;
    if (r.status === "cancelled") b.cancelled++; else b.booked++;
  }
  for (const t of trials) {
    const b = index.get(t.date.slice(0, 7));
    if (!b) continue;
    b.t++;
    if (t.converted) b.c++;
  }

  // 該月沒資料就給 null 讓線斷開，畫成 0% 會誤導
  for (const { p, booked, cancelled, t, c } of index.values()) {
    const all = booked + cancelled;
    if (all > 0) {
      p.cancelRate = +((cancelled / all) * 100).toFixed(1);
      p.cancelNote = `取消 ${cancelled} / 共 ${all} 筆`;
    }
    if (t > 0) {
      p.convRate = +((c / t) * 100).toFixed(1);
      p.convNote = `${c} / ${t} 位`;
    }
  }
  return points;
}

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "－");

export default function ReportsTab({ store }: { store: Store }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  /** 客戶回訪要靠會員資料認人與算年齡 */
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [view, setView] = useState<"overview" | "retention">("overview");
  const [err, setErr] = useState("");

  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(todayStr());
  // 複檢預設不勾，跟舊系統一樣
  const [picked, setPicked] = useState<Set<string>>(new Set(["一般預約", "新客體驗"]));

  const load = useCallback(async () => {
    setErr("");

    /*
     * 會員清單整份撈回來：自己人（有設身分的）要拿來排除，
     * 客戶回訪那邊還要靠它認人與算年齡。分兩次查等於同一份資料撈兩遍。
     */
    const { data: all_members, error: e1 } = await supabase
      .from("members")
      .select("id,name,phone,birthday,role,line_user_id")
      .eq("store_id", store.id);
    if (e1) { setErr(e1.message); return; }
    setMembers(all_members as MemberRow[]);

    // 自己人：用 id、電話、姓名三種方式認，
    // 沒接上會員的預約（手打的、舊資料）也擋得掉
    const staff = all_members.filter((m) => m.role !== null);

    const all: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("bookings")
        .select("date,start_time,type,status,name,phone,member_id")
        .eq("store_id", store.id)
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) { setErr(error.message); return; }
      all.push(...(data as Row[]));
      if (data.length < PAGE) break;
    }

    const ids = new Set(staff.map((m) => m.id));
    const phones = new Set(staff.map((m) => digits(m.phone)).filter(Boolean));
    const names = new Set(staff.map((m) => m.name.trim()).filter(Boolean));

    setRows(all.filter((r) => {
      const name = r.name.trim();
      if (name.includes("卡")) return false;
      if (r.member_id && ids.has(r.member_id)) return false;
      if (names.has(name)) return false;
      const p = digits(r.phone);
      return !(p && phones.has(p));
    }));
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  const { start, end } = periodRange(period, anchor);
  const atLatest = start >= periodRange(period, todayStr()).start;

  const stats = useMemo(() => {
    if (!rows) return null;
    const inRange = (r: Row, s: string, e: string) => r.date >= s && r.date <= e;
    const visits = rows.filter((r) => r.status !== "cancelled");

    const counted = visits.filter((r) => picked.has(r.type) && inRange(r, start, end));
    const total = counted.length;
    const trial = counted.filter((r) => r.type === "新客體驗").length;

    const prev = periodRange(period, shift(period, start, -1));
    const prevTotal = visits.filter((r) => picked.has(r.type) && inRange(r, prev.start, prev.end)).length;

    const days = period === "year" ? 12
      : Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86400000) + 1;

    // 取消率：所有類型
    const booked = visits.filter((r) => inRange(r, start, end)).length;
    const cancelled = rows.filter((r) => r.status === "cancelled" && inRange(r, start, end)).length;

    // 新客轉換率
    const trials = trialOutcomes(visits);
    const inPeriod = trials.filter((t) => t.date >= start && t.date <= end);
    const converted = inPeriod.filter((t) => t.converted).length;

    const buckets = buildBuckets(period, start, end, TYPES.filter((t) => picked.has(t)), counted);

    return {
      total, trial, prevTotal, days, booked, cancelled, converted, buckets, counted,
      trials: inPeriod.length,
      rates: rateTrend(rows, trials),
    };
  }, [rows, picked, period, start, end]);

  function toggle(t: string) {
    const next = new Set(picked);
    if (next.has(t)) {
      if (next.size === 1) return;                   // 至少留一種，不然全部都是 0
      next.delete(t);
    } else {
      next.add(t);
    }
    setPicked(next);
  }

  function compare() {
    if (!stats) return { text: "－", color: undefined };
    const { total, prevTotal } = stats;
    if (prevTotal === 0) return { text: total > 0 ? `▲ 新增 ${total}` : "－", color: undefined };
    const diff = Math.round(((total - prevTotal) / prevTotal) * 100);
    return diff >= 0
      ? { text: `▲ +${diff}%`, color: "var(--ok)" }
      : { text: `▼ ${diff}%`, color: "var(--danger)" };
  }
  const cmp = compare();

  return (
    <div>
      <div className="tabs">
        <button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")}>
          📊 營運概況
        </button>
        <button type="button" aria-pressed={view === "retention"} onClick={() => setView("retention")}>
          💗 客戶回訪
        </button>
      </div>

      {view === "retention" && (
        rows === null
          ? <div className="panel"><div className="skeleton" style={{ height: "8rem" }} /></div>
          : <RetentionPanel store={store} rows={rows} members={members} />
      )}

      {view === "overview" && <>
      <div className="panel">
        <div className="seg">
          {([["week", "週"], ["month", "月"], ["year", "年"]] as const).map(([k, label]) => (
            <button
              key={k} type="button" aria-pressed={period === k}
              onClick={() => { setPeriod(k); setAnchor(todayStr()); }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="cal-bar" style={{ marginTop: "0.875rem", justifyContent: "space-between" }}>
          <button className="slim outline" onClick={() => setAnchor(shift(period, anchor, -1))}>
            ◀ 上一期
          </button>
          <b>{periodLabel(period, start, end)}</b>
          <button
            className="slim outline" disabled={atLatest}
            onClick={() => setAnchor(shift(period, anchor, 1))}
          >
            下一期 ▶
          </button>
        </div>

        <label style={{ marginTop: "0.5rem" }}>類型（套用在來客數、新客比例、與上期比較、平均）</label>
        <div className="chips" style={{ marginTop: 0 }}>
          {TYPES.map((t) => {
            const on = picked.has(t);
            return (
              <button
                key={t} type="button" className="chip" aria-pressed={on}
                style={on ? { background: TYPE_COLORS[t], borderColor: TYPE_COLORS[t], color: "#fff" } : undefined}
                onClick={() => toggle(t)}
              >
                {on ? "✅" : "⬜"} {t}
              </button>
            );
          })}
        </div>
      </div>

      {err && <div className="msg err">讀取失敗：{err}</div>}

      {!stats
        ? !err && <div className="skeleton" style={{ height: "8rem" }} />
        : (
          <div className="stat-row">
            <div className="stat">
              <div className="k">👥 來客數</div>
              <div className="n">{stats.total} <small>人次</small></div>
              <div className="hint">已選：{TYPES.filter((t) => picked.has(t)).join("、")}</div>
            </div>
            <div className="stat">
              <div className="k">🌱 新客比例</div>
              <div className="n">{pct(stats.trial, stats.total)}</div>
              <div className="hint">新客體驗 {stats.trial} 人次</div>
            </div>
            <div className="stat">
              <div className="k">📊 與上期比較</div>
              <div className="n" style={{ color: cmp.color }}>{cmp.text}</div>
              <div className="hint">上一期 {stats.prevTotal} 人次</div>
            </div>
            <div className="stat">
              <div className="k">📅 {period === "year" ? "平均每月" : "平均每天"}</div>
              <div className="n">{(stats.total / stats.days).toFixed(1)} <small>人次</small></div>
              <div className="hint">整段期間平均</div>
            </div>
            <div className="stat">
              <div className="k">❌ 取消率</div>
              <div className="n">{pct(stats.cancelled, stats.cancelled + stats.booked)}</div>
              <div className="hint">所有類型（含複檢），取消 {stats.cancelled} 筆</div>
            </div>
            <div className="stat">
              <div className="k">🔁 新客轉換率</div>
              <div className="n">{pct(stats.converted, stats.trials)}</div>
              <div className="hint">
                {stats.trials > 0
                  ? `${stats.converted} / ${stats.trials} 位體驗後有一般預約`
                  : `本期沒有滿 ${CONVERSION_MATURE_DAYS} 天的新客體驗`}
              </div>
            </div>
          </div>
        )}

      {stats && (
        <div style={{ marginTop: "0.875rem" }}>
          <TrendChart
            buckets={stats.buckets}
            types={TYPES.filter((t) => picked.has(t))}
            colors={TYPE_COLORS}
          />
          <Heatmap rows={stats.counted} />
          <RateTrend points={stats.rates} />
        </div>
      )}
      </>}
    </div>
  );
}
