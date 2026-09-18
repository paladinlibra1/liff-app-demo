import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * 💗 客戶回訪
 *
 * 看的是「全部歷史」，不跟著上面的期間與類型篩選——回訪本來就是長期的事，
 * 只看這一週會把每個人都算成新客。
 *
 * 認人以會員為主、電話為輔：電話是人工輸入的，打錯一個字就會把同一位客人
 * 拆成兩個，其中一半看起來很久沒來。v2 的預約大多帶 member_id，
 * 比舊系統只能靠電話／LINE 對照可靠得多。
 */

export interface VisitRow {
  date: string;
  status: string;
  name: string;
  phone: string;
  member_id: string | null;
}

export interface MemberRow {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
  role: string | null;
  /** 沒綁 LINE 就發不了訊息，名單上要標出來 */
  line_user_id: string | null;
}

/** 幾天沒來就算沉睡客。沿用舊系統 */
const DORMANT_DAYS = 90;

/** 年齡級距，每 5 歲一級 */
const BAND = 5;
/** 生日合理範圍，跟會員編輯表單同一組門檻（最常見的錯是把民國年當西元年） */
const AGE_MIN = 5;
const AGE_MAX = 95;

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");

function ageOf(birthday: string): number | null {
  const d = new Date(birthday + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

export default function RetentionPanel({
  rows, members,
}: {
  /** 已經排除自己人的全部預約 */
  rows: VisitRow[];
  members: MemberRow[];
}) {
  /** 兩份名單共用同一塊，用按鈕切換——分開放的話報表會拉得很長 */
  const [list, setList] = useState<"dormant" | "never">("dormant");
  /** 沒綁 LINE 的人發不了訊息，預設收起來，但要留一個看得見的入口 */
  const [showNoLine, setShowNoLine] = useState(false);

  const data = useMemo(() => {
    const byPhone = new Map<string, MemberRow>();
    for (const m of members) {
      const p = digits(m.phone);
      if (p) byPhone.set(p, m);
    }
    const byId = new Map(members.map((m) => [m.id, m]));

    /*
     * 歸戶：有 member_id 就用它，沒有才退回電話。
     * 兩者都沒有的預約（極少數手打的）認不出是誰，跳過。
     */
    type Person = { key: string; name: string; count: number; last: string; member: MemberRow | null };
    const people = new Map<string, Person>();

    for (const r of rows) {
      if (r.status === "cancelled") continue;          // 取消的不算到店
      const phone = digits(r.phone);
      const member = (r.member_id && byId.get(r.member_id)) || (phone && byPhone.get(phone)) || null;
      const key = member ? `M:${member.id}` : phone ? `P:${phone}` : "";
      if (!key) continue;

      const cur = people.get(key) ?? { key, name: r.name, count: 0, last: "", member };
      cur.count++;
      if (r.date > cur.last) {
        cur.last = r.date;
        if (r.name) cur.name = r.name;                 // 以最近一次填的姓名為準
      }
      // 會員清單的姓名比預約單上的可靠（事後改過名字的以會員為準）
      if (cur.member?.name) cur.name = cur.member.name;
      people.set(key, cur);
    }

    const all = [...people.values()];
    const fresh = all.filter((p) => p.count === 1).length;
    const returning = all.filter((p) => p.count >= 2 && p.count <= 4).length;
    const frequent = all.filter((p) => p.count >= 5).length;

    // 年齡層：一位客人算一個，不是來店人次
    const bands = new Map<number, number>();
    let missing = 0;      // 沒填生日
    let odd = 0;          // 有生日但算出來不合理
    for (const p of all) {
      const b = p.member?.birthday;
      if (!b) { missing++; continue; }
      const age = ageOf(b);
      if (age === null || age <= AGE_MIN || age >= AGE_MAX) { odd++; continue; }
      const band = Math.floor(age / BAND) * BAND;
      bands.set(band, (bands.get(band) ?? 0) + 1);
    }

    // 中間沒人的級距也要留一格，不然看不出分布的形狀
    const keys = [...bands.keys()].sort((a, b) => a - b);
    const chart: { label: string; n: number }[] = [];
    if (keys.length) {
      for (let b = keys[0]; b <= keys[keys.length - 1]; b += BAND) {
        chart.push({ label: `${b}–${b + BAND - 1}`, n: bands.get(b) ?? 0 });
      }
    }

    /*
     * 😴 沉睡客：最近一次到店超過 DORMANT_DAYS 天。
     * 久的排前面——越久沒來越該先關心。
     */
    const today = new Date();
    const dormant = all
      .filter((p) => p.last)
      .map((p) => ({
        ...p,
        days: Math.round((today.getTime() - new Date(p.last + "T00:00:00").getTime()) / 86400000),
      }))
      .filter((p) => p.days > DORMANT_DAYS)
      .sort((a, b) => b.days - a.days);

    /*
     * 🆕 已加會員但從未預約：會員清單裡找不到任何預約的人。
     * 只列身分是「客人」的（店家／助理／夥伴不算），姓名含「卡」的也不算
     * ——那是舊系統留下來的儲值卡紀錄，不是人。
     */
    const bookedIds = new Set(all.map((p) => p.member?.id).filter(Boolean));
    const bookedPhones = new Set(rows.map((r) => digits(r.phone)).filter(Boolean));
    const never = members
      .filter((m) => !m.role && !m.name.includes("卡"))
      .filter((m) => !bookedIds.has(m.id) && !bookedPhones.has(digits(m.phone)))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));

    return {
      total: all.length, fresh, returning, frequent, chart, missing, odd,
      known: all.length - missing - odd, dormant, never,
    };
  }, [rows, members]);

  return (
    <>
      <div className="panel">
        <div className="panel-title">👥 客戶回訪分析</div>
        <p className="hint" style={{ marginTop: 0 }}>
          看全部歷史，不受上面的期間與類型影響。到店次數含所有類型，取消的不算。
        </p>

        <div className="stat-row">
          <div className="stat">
            <div className="n">{data.fresh}</div>
            <div className="k">新客（只來過 1 次）</div>
          </div>
          <div className="stat">
            <div className="n">{data.returning}</div>
            <div className="k">回頭客（2–4 次）</div>
          </div>
          <div className="stat">
            <div className="n">{data.frequent}</div>
            <div className="k">常客（5 次以上）</div>
          </div>
          <div className="stat">
            <div className="n">{data.total}</div>
            <div className="k">總客人數</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">🎂 年齡層分布（每 5 歲一級距）</div>
        <p className="hint" style={{ marginTop: 0 }}>
          已列入 {data.known} 位
          {data.missing > 0 && `，未填生日 ${data.missing} 位`}
          {data.odd > 0 && `，生日異常 ${data.odd} 位`}
          。生日在會員清單裡，沒填的就算不出年齡。
        </p>

        {data.chart.length === 0 ? (
          <p className="hint">還沒有可以分析的生日資料。</p>
        ) : (
          <div style={{ width: "100%", height: "18rem" }}>
            <ResponsiveContainer>
              <BarChart data={data.chart} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis width={36} allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [`${v} 位`, "人數"]} />
                <Bar dataKey="n" name="人數" fill="#f6c026" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  <LabelList dataKey="n" position="top" style={{ fontSize: 12, fill: "var(--ink-soft)" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <FollowUpLists
        list={list} setList={setList}
        showNoLine={showNoLine} setShowNoLine={setShowNoLine}
        dormant={data.dormant} never={data.never}
      />
    </>
  );
}

/** 沉睡客／從未預約兩份名單 */
function FollowUpLists({
  list, setList, showNoLine, setShowNoLine, dormant, never,
}: {
  list: "dormant" | "never";
  setList: (v: "dormant" | "never") => void;
  showNoLine: boolean;
  setShowNoLine: (v: boolean) => void;
  dormant: { key: string; name: string; count: number; last: string; days: number; member: MemberRow | null }[];
  never: MemberRow[];
}) {
  const isDormant = list === "dormant";
  const noLineOf = (m: MemberRow | null) => !m?.line_user_id;

  const shownDormant = dormant.filter((p) => showNoLine || !noLineOf(p.member));
  const shownNever = never.filter((m) => showNoLine || !noLineOf(m));
  const count = isDormant ? shownDormant.length : shownNever.length;
  const noLineCount = isDormant
    ? dormant.filter((p) => noLineOf(p.member)).length
    : never.filter((m) => noLineOf(m)).length;

  return (
    <div className="panel">
      <div className="seg" style={{ marginBottom: "0.875rem" }}>
        <button type="button" aria-pressed={isDormant} onClick={() => setList("dormant")}>
          😴 沉睡客
        </button>
        <button type="button" aria-pressed={!isDormant} onClick={() => setList("never")}>
          🆕 從未預約
        </button>
      </div>

      <div className="panel-title" style={{ margin: 0 }}>
        {isDormant
          ? `😴 沉睡客名單（最近一次到店超過 ${DORMANT_DAYS} 天）`
          : "🆕 已加會員但從未預約（只列身分為客人）"}
      </div>
      <p className="hint">
        共 {count} 位
        {noLineCount > 0 && (
          <>
            {" "}·{" "}💬 {noLineCount} 位沒綁 LINE
            <button
              className="linkish" onClick={() => setShowNoLine(!showNoLine)}
            >
              {showNoLine ? "隱藏" : "顯示"}
            </button>
          </>
        )}
      </p>

      {count === 0 ? (
        <p className="hint">{isDormant ? "目前沒有沉睡客。" : "沒有從未預約的會員。"}</p>
      ) : (
        <div className="rows" style={{ marginTop: "0.625rem" }}>
          {isDormant
            ? shownDormant.map((p) => (
              <div className="arow stock" key={p.key}>
                <div className="c grow">
                  <b>{p.name || "（沒有姓名）"}</b>
                  {noLineOf(p.member)
                    ? <span className="badge old">沒綁 LINE</span>
                    : <span className="tag2 line">LINE</span>}
                  <div className="sub" style={{ marginTop: "0.1875rem" }}>
                    上次到店 {p.last}（{p.days} 天前）· 累計 {p.count} 次
                    {p.member?.phone && ` · ${p.member.phone}`}
                  </div>
                </div>
              </div>
            ))
            : shownNever.map((m) => (
              <div className="arow stock" key={m.id}>
                <div className="c grow">
                  <b>{m.name}</b>
                  {noLineOf(m)
                    ? <span className="badge old">沒綁 LINE</span>
                    : <span className="tag2 line">LINE</span>}
                  <div className="sub" style={{ marginTop: "0.1875rem" }}>{m.phone}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
