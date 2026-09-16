/**
 * 🔥 時段熱度：星期 × 小時，格子越深代表越多人
 *
 * 預約是每半小時一格，全列出來太長，所以以小時分桶（12:00 與 12:30 都算 12 點）。
 * 週日平常沒開，只有本期真的有週日預約才多一欄，不然整欄空白只是佔位。
 * 最早到最晚之間沒人的小時也留一列，才看得出哪裡是空檔。
 */

const DOW = ["一", "二", "三", "四", "五", "六", "日"];

export default function Heatmap({ rows }: { rows: { date: string; start_time: string }[] }) {
  // counts[小時][星期]，星期 0=一 … 6=日
  const counts = new Map<number, number[]>();
  let hasSunday = false;
  for (const r of rows) {
    const h = parseInt(r.start_time, 10);
    if (Number.isNaN(h)) continue;
    const wd = (new Date(r.date + "T00:00:00Z").getUTCDay() + 6) % 7;
    if (wd === 6) hasSunday = true;
    if (!counts.has(h)) counts.set(h, [0, 0, 0, 0, 0, 0, 0]);
    counts.get(h)![wd]++;
  }

  const hours = [...counts.keys()];
  const days = hasSunday ? 7 : 6;

  return (
    <div className="panel">
      <div className="panel-title">🔥 時段熱度</div>
      <p className="hint" style={{ marginTop: 0 }}>本期、依上面勾選的類型，以 1 小時為一格</p>

      {hours.length === 0
        ? <div className="empty"><p>本期還沒有資料</p></div>
        : (() => {
          const min = Math.min(...hours);
          const max = Math.max(...hours);
          const list: number[] = [];
          for (let h = min; h <= max; h++) list.push(h);
          const peak = Math.max(1, ...list.flatMap((h) => counts.get(h) ?? []));

          return (
            <div className="heat-scroll">
              <table className="heat">
                <thead>
                  <tr>
                    <th />
                    {DOW.slice(0, days).map((d) => <th key={d}>週{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map((h) => (
                    <tr key={h}>
                      <th className="h">{h} 點</th>
                      {(counts.get(h) ?? [0, 0, 0, 0, 0, 0, 0]).slice(0, days).map((c, i) => {
                        // 最少也留一點底色，0 跟「很少」才分得出來
                        const pct = c === 0 ? 0 : Math.round(15 + (c / peak) * 85);
                        return (
                          <td key={i}>
                            <div
                              className="cell"
                              title={`週${DOW[i]} ${h} 點：${c} 人`}
                              style={{
                                background: c === 0
                                  ? "var(--rose-wash)"
                                  : `color-mix(in srgb, var(--rose) ${pct}%, #fff)`,
                                color: pct > 55 ? "#fff" : "var(--ink)",
                              }}
                            >
                              {c > 0 ? c : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
    </div>
  );
}
