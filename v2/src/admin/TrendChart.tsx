import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * 📈 來客趨勢
 *
 * 人數：堆疊直條，柱子上標數字。
 * %：每一格裡各類型的占比，改用折線——堆疊到 100% 的直條看不出走勢。
 * 兩種都用同一份 buckets，切換不用重算。
 */

export type Bucket = { label: string } & Record<string, number | string>;

type Mode = "count" | "percent";

export default function TrendChart({
  buckets, types, colors,
}: {
  buckets: Bucket[];
  /** 已勾選的類型，決定畫幾個系列 */
  types: string[];
  colors: Record<string, string>;
}) {
  const [mode, setMode] = useState<Mode>("count");

  const percent = buckets.map((b) => {
    const total = types.reduce((s, t) => s + (b[t] as number), 0);
    const out: Bucket = { label: b.label };
    for (const t of types) {
      out[t] = total > 0 ? +(((b[t] as number) / total) * 100).toFixed(1) : 0;
    }
    return out;
  });

  const unit = mode === "percent" ? "%" : " 人";
  const tooltip = (
    <Tooltip formatter={(v) => `${v}${unit}`} cursor={{ fill: "rgba(0,0,0,.04)" }} />
  );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
      <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" minTickGap={4} />
      <YAxis
        allowDecimals={false} width={36} tick={{ fontSize: 12 }}
        domain={mode === "percent" ? [0, 100] : [0, "auto"]}
        tickFormatter={(v) => (mode === "percent" ? `${v}%` : String(v))}
      />
      {tooltip}
      <Legend wrapperStyle={{ fontSize: "0.8125rem" }} />
    </>
  );

  return (
    <div className="panel">
      <div className="hours-head">
        <div className="panel-title" style={{ margin: 0 }}>📈 來客趨勢</div>
        <div className="seg" style={{ width: "9rem" }}>
          <button type="button" aria-pressed={mode === "count"} onClick={() => setMode("count")}>
            人數
          </button>
          <button type="button" aria-pressed={mode === "percent"} onClick={() => setMode("percent")}>
            %
          </button>
        </div>
      </div>

      <div style={{ width: "100%", height: "20rem" }}>
        <ResponsiveContainer>
          {mode === "count" ? (
            <BarChart data={buckets} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              {axes}
              {types.map((t) => (
                <Bar key={t} dataKey={t} stackId="a" fill={colors[t]} isAnimationActive={false}>
                  {/* 0 不標，不然每根空柱子底下都是一排 0 */}
                  <LabelList
                    dataKey={t} position="center" fill="#fff" fontSize={11} fontWeight={700}
                    formatter={(v) => (Number(v) > 0 ? String(v) : "")}
                  />
                </Bar>
              ))}
            </BarChart>
          ) : (
            <LineChart data={percent} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              {axes}
              {types.map((t) => (
                <Line
                  key={t} dataKey={t} stroke={colors[t]} strokeWidth={2}
                  dot={{ r: 3 }} type="monotone" isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
