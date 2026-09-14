import { useMemo } from "react";

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export interface DayState {
  isOperating: boolean;
  blockedCount: number;
}

/**
 * 營業日月曆
 *
 * 照舊系統 admin.html 的操作方式做：
 *   - 點「非營業日」→ 加入／移除批次選取（可以跳著點很多天）
 *   - 點「營業日」  → 清掉選取，打開那天的封鎖時段面板
 *
 * 排一個月的班，舊系統點十幾下就好；一天一顆開關的話要按十幾次、
 * 送十幾筆請求。批次是這個畫面存在的理由，不是附加功能。
 *
 * 沒有用 FullCalendar：需要的只是 7 欄格子，自己刻少一個相依套件，
 * 而且手機上的尺寸比較好控制。
 */
export default function OperatingCalendar({
  month, today, state, selected, onPick,
}: {
  /** `YYYY-MM` */
  month: string;
  /** `YYYY-MM-DD`，用來把過去的日子畫淡 */
  today: string;
  /** 日期 → 狀態 */
  state: Record<string, DayState>;
  /** 批次選取中的日期 */
  selected: Set<string>;
  onPick: (date: string) => void;
}) {
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = first.getUTCDay();                    // 這個月從星期幾開始
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= total; d++) {
      out.push(`${month}-${String(d).padStart(2, "0")}`);
    }
    return out;
  }, [month]);

  return (
    <div className="cal">
      <div className="cal-week">
        {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
      </div>

      <div className="cal-grid">
        {cells.map((date, i) => {
          if (!date) return <div key={"b" + i} className="cal-cell blank" />;

          const s = state[date];
          const on = s?.isOperating ?? false;
          const blocked = s?.blockedCount ?? 0;
          const cls = [
            "cal-cell",
            on ? "on" : "",
            selected.has(date) ? "sel" : "",
            date < today ? "past" : "",
            date === today ? "today" : "",
          ].filter(Boolean).join(" ");

          return (
            <button key={date} type="button" className={cls} onClick={() => onPick(date)}>
              <span className="n">{Number(date.slice(8))}</span>
              {on && <span className="mark">營業</span>}
              {blocked > 0 && <span className="blk">封鎖 {blocked}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
