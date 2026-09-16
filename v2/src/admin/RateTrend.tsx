import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * 📈 營運趨勢（近 12 個月）：取消率、新客轉換率的月線
 *
 * 提示框會帶上原始筆數——只看百分比不知道分母多小，
 * 一個月只有 2 位新客的 50% 跟 20 位的 50% 不是同一件事。
 */

export interface RatePoint {
  /** `26/9` */
  label: string;
  cancelRate: number | null;
  convRate: number | null;
  cancelNote: string;
  convNote: string;
}

const SERIES = [
  { key: "convRate", note: "convNote", name: "新客轉換率", color: "#4CAF50" },
  { key: "cancelRate", note: "cancelNote", name: "取消率", color: "#e57373" },
] as const;

export default function RateTrend({ points }: { points: RatePoint[] }) {
  return (
    <div className="panel">
      <div className="panel-title">📈 營運趨勢（近 12 個月）</div>
      <p className="hint" style={{ marginTop: 0 }}>
        固定看最近 12 個月，不受上面的期間與類型影響。
        新客轉換率只算體驗滿 30 天的人，所以最近一個月通常還是空的。
      </p>

      <div style={{ width: "100%", height: "20rem" }}>
        <ResponsiveContainer>
          <LineChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={4} />
            <YAxis
              domain={[0, 100]} width={40} tick={{ fontSize: 12 }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              formatter={(v, name, item) => {
                const s = SERIES.find((x) => x.name === name);
                const note = s ? (item.payload as RatePoint)[s.note] : "";
                return [`${v}%（${note}）`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: "0.8125rem" }} />
            {SERIES.map((s) => (
              <Line
                key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2}
                dot={{ r: 4 }} type="monotone" connectNulls={false} isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
