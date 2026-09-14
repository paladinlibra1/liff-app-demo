import { useEffect, useMemo, useState } from "react";
import {
  fetchStore, fetchAvailability, submitBooking,
  type StoreInfo, type DayAvailability,
} from "./api";
import { initLiff, closeLiffWindow, type LiffState } from "./liff";
import { isValidPhone, PHONE_RULE_MSG } from "../shared/phone";

/** 沿用舊系統 index.html 的三種預約身分 */
const TYPES = ["新客體驗", "一般預約", "複檢"];

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

/** `2026-09-17` → `9/17（週三）` */
function dateLabel(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（週${WEEK[d.getUTCDay()]}）`;
}

interface Done {
  date: string;
  time: string;
  type: string;
  who: string;
}

export default function BookingApp() {
  const [liffState, setLiffState] = useState<LiffState | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [days, setDays] = useState<DayAvailability[] | null>(null);
  const [loadErr, setLoadErr] = useState("");

  // ── 表單 ──────────────────────────────────────────
  const [type, setType] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [twoPeople, setTwoPeople] = useState(false);
  const [name2, setName2] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [remark, setRemark] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  // ── 啟動：LINE 身分與店家資料同時抓 ───────────────
  useEffect(() => {
    let cancelled = false;

    initLiff().then((state) => {
      if (cancelled) return;
      setLiffState(state);
      // 姓名先帶 LINE 暱稱，客人可以改成本名
      if (state.kind === "ready") setName((n) => n || state.viewer.displayName);
    });

    Promise.all([fetchStore(), fetchAvailability()])
      .then(([s, a]) => {
        if (cancelled) return;
        setStore(s);
        setDays(a.days);
      })
      .catch((e: Error) => !cancelled && setLoadErr(e.message));

    return () => { cancelled = true; };
  }, []);

  const seats = twoPeople ? 2 : 1;

  /** 有營業而且至少還有一個位子的日子才列出來 */
  const openDays = useMemo(
    () => (days ?? []).filter((d) => d.isOperating && d.slots.some((s) => s.remaining > 0)),
    [days],
  );

  const slots = useMemo(
    () => days?.find((d) => d.date === date)?.slots ?? [],
    [days, date],
  );

  // 改成兩位時，原本選的時段可能就塞不下了，要把它清掉而不是讓客人送出才被擋
  useEffect(() => {
    if (!time) return;
    const picked = slots.find((s) => s.time === time);
    if (!picked || picked.remaining < seats) setTime("");
  }, [seats, slots, time]);

  async function reloadAvailability() {
    try {
      const a = await fetchAvailability();
      setDays(a.days);
    } catch {
      /* 重新整理失敗就維持舊資料，不要再蓋一層錯誤訊息 */
    }
  }

  async function handleSubmit() {
    if (submitting) return;          // 防連點：送出期間整支直接擋掉
    setFormErr("");

    if (!type) return setFormErr("請選擇預約身分");
    if (!name.trim()) return setFormErr("請填姓名");
    if (!phone.trim()) return setFormErr("請填聯絡電話");
    if (!isValidPhone(phone)) return setFormErr(PHONE_RULE_MSG);
    if (twoPeople && !name2.trim()) return setFormErr("請填第二位的姓名");
    if (!date) return setFormErr("請選擇日期");
    if (!time) return setFormErr("請選擇時間");

    if (liffState?.kind !== "ready") {
      return setFormErr("尚未取得 LINE 身分，請從 LINE 裡開啟這個頁面");
    }

    setSubmitting(true);
    try {
      await submitBooking(liffState.viewer.accessToken, {
        type, name: name.trim(), phone: phone.trim(),
        name2: twoPeople ? name2.trim() : null,
        date, time,
        remark: remark.trim() || null,
      });
      setDone({
        date, time, type,
        who: twoPeople ? `${name.trim()}、${name2.trim()}` : name.trim(),
      });
    } catch (e) {
      setFormErr((e as Error).message);
      // 額滿或被搶走的情況下，畫面上的剩餘位子已經過時了
      await reloadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  // ── 完成畫面 ──────────────────────────────────────
  if (done) {
    return (
      <div className="wrap narrow">
        <Brand store={store} />
        <div className="panel done">
          <div className="mark">✓</div>
          <h1>預約完成</h1>
          <p className="sub">我們會在預約前一天用 LINE 提醒您。</p>
          <div className="summary">
            <Row k="日期" v={dateLabel(done.date)} />
            <Row k="時間" v={done.time} />
            <Row k="預約身分" v={done.type} />
            <Row k="姓名" v={done.who} />
          </div>
          <button onClick={closeLiffWindow}>關閉</button>
          <button
            className="ghost"
            onClick={() => { setDone(null); setDate(""); setTime(""); setRemark(""); reloadAvailability(); }}
          >
            再預約一筆
          </button>
        </div>
      </div>
    );
  }

  // ── 載入中 ────────────────────────────────────────
  if (!store || !days) {
    return (
      <div className="wrap narrow">
        <Brand store={store} />
        {loadErr
          ? <div className="panel"><div className="msg err">{loadErr}</div></div>
          : <LoadingSkeleton />}
      </div>
    );
  }

  return (
    <div className="wrap narrow">
      <Brand store={store} />

      {liffState?.kind === "preview" && (
        <div className="msg note" style={{ marginTop: 0, marginBottom: 14 }}>
          開發預覽模式（{liffState.reason}）。畫面可以操作，但沒有 LINE 身分，
          送出會被擋下來。
        </div>
      )}
      {liffState?.kind === "error" && (
        <div className="msg err" style={{ marginTop: 0, marginBottom: 14 }}>
          {liffState.message}
        </div>
      )}

      <div className="panel">
        <div className="panel-title">您的資料</div>
        <div className="field">
          <label>預約身分</label>
          <div className="seg">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                onClick={() => setType(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="name">姓名</label>
          <input
            id="name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="請填真實姓名" autoComplete="name"
          />
        </div>

        <div className="field">
          <label htmlFor="phone">聯絡電話</label>
          <input
            id="phone" value={phone} onChange={(e) => setPhone(e.target.value)}
            type="tel" inputMode="tel" maxLength={16}
            placeholder="0912345678" autoComplete="tel"
          />
        </div>

        <div className="field">
          <label className={"check" + (twoPeople ? " on" : "")}>
            <input
              type="checkbox" checked={twoPeople}
              onChange={(e) => setTwoPeople(e.target.checked)}
            />
            兩位一起預約
          </label>
          {twoPeople && (
            <input
              style={{ marginTop: 8 }}
              value={name2} onChange={(e) => setName2(e.target.value)}
              placeholder="第二位的姓名"
            />
          )}
        </div>

        <div className="field">
          <label htmlFor="remark">備註（可不填）</label>
          <textarea
            id="remark" value={remark} onChange={(e) => setRemark(e.target.value)}
            placeholder="想先讓我們知道的事，例如膚況、想處理的部位"
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">選擇時間</div>
        <div className="field">
          <label htmlFor="date">日期</label>
          <select id="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }}>
            <option value="">請選擇日期</option>
            {openDays.map((d) => (
              <option key={d.date} value={d.date}>{dateLabel(d.date)}</option>
            ))}
          </select>
          {openDays.length === 0 && (
            <p className="hint">目前還沒有開放的日期，請稍後再看看或直接聯絡店家。</p>
          )}
        </div>

        {date && (
          <div className="field">
            <label>時間</label>
            <div className="slots">
              {slots.map((s) => {
                const full = s.remaining < seats;
                return (
                  <button
                    key={s.time}
                    type="button"
                    className="slot"
                    disabled={full}
                    aria-pressed={time === s.time}
                    onClick={() => setTime(s.time)}
                  >
                    {s.time}
                    <span className="left">{full ? "額滿" : `剩 ${s.remaining} 位`}</span>
                  </button>
                );
              })}
            </div>
            {slots.length === 0 && <p className="hint">這一天沒有可預約的時段。</p>}
            {twoPeople && (
              <p className="hint">兩位一起需要同一時段有兩個空位，剩一位的時段會顯示額滿。</p>
            )}
          </div>
        )}
      </div>

      {formErr && <div className="msg err">{formErr}</div>}

      <button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "送出中…" : "送出預約"}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function Brand({ store }: { store: StoreInfo | null }) {
  return (
    <div className="brand">
      <div className="name">{store?.name ?? " "}</div>
      <div className="tag">線上預約</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="panel">
        <div className="skeleton" style={{ height: 42, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 42, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 42 }} />
      </div>
      <div className="panel">
        <div className="skeleton" style={{ height: 42 }} />
      </div>
    </>
  );
}
