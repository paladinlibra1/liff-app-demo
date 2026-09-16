import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import TrendChart, { type Bucket } from "./TrendChart";

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

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "－");

export default function ReportsTab({ store }: { store: Store }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(todayStr());
  // 複檢預設不勾，跟舊系統一樣
  const [picked, setPicked] = useState<Set<string>>(new Set(["一般預約", "新客體驗"]));

  const load = useCallback(async () => {
    setErr("");

    // 有設身分的會員：用 id、電話、姓名三種方式認，
    // 沒接上會員的預約（手打的、舊資料）也擋得掉
    const { data: staff, error: e1 } = await supabase
      .from("members")
      .select("id,name,phone")
      .eq("store_id", store.id)
      .not("role", "is", null);
    if (e1) { setErr(e1.message); return; }

    const all: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("bookings")
        .select("date,type,status,name,phone,member_id")
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
    const matureBefore = fmt(new Date(toDate(todayStr()).getTime() - CONVERSION_MATURE_DAYS * 86400000));
    const firstTrial = new Map<string, string>();
    const generals = new Map<string, string[]>();
    for (const r of visits) {
      const p = digits(r.phone);
      if (!p) continue;
      if (r.type === "新客體驗") {
        const cur = firstTrial.get(p);
        if (!cur || r.date < cur) firstTrial.set(p, r.date);
      } else if (r.type === "一般預約") {
        generals.set(p, [...(generals.get(p) ?? []), r.date]);
      }
    }
    const trials = [...firstTrial].filter(([, d]) => d >= start && d <= end && d <= matureBefore);
    // 體驗「之後」的一般預約才算，同一天的不算
    const converted = trials.filter(([p, d]) => (generals.get(p) ?? []).some((g) => g > d)).length;

    const buckets = buildBuckets(period, start, end, TYPES.filter((t) => picked.has(t)), counted);

    return { total, trial, prevTotal, days, booked, cancelled, trials: trials.length, converted, buckets };
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
        </div>
      )}
    </div>
  );
}
