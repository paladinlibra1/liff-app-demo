import { useEffect, useMemo, useState } from "react";
import {
  fetchStore, fetchAvailability, fetchMe, submitBooking,
  type StoreInfo, type DayAvailability, type MyProfile,
} from "./api";
import RegisterForm from "./RegisterForm";
import { initLiff, closeLiffWindow, type LiffState } from "./liff";
import { isValidPhone, PHONE_RULE_MSG } from "../shared/phone";
import { birthdayError } from "../shared/birthday";

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
  const [birthday, setBirthday] = useState("");
  /** 會員資料；null ＝ 還沒綁定，要先擋下來綁 */
  const [member, setMember] = useState<MyProfile | null>(null);
  /** 有沒有問過後端「綁了沒」。沒問過之前不能判定成未綁定 */
  const [checked, setChecked] = useState(false);

  /*
   * 幫別人訂。
   *
   * 對方的姓名電話另外存，不要蓋掉從會員帶出來的那兩欄——
   * 不然客人切回「訂給自己」時自己的資料就不見了。
   */
  const [forOther, setForOther] = useState(false);
  const [otherName, setOtherName] = useState("");
  const [otherPhone, setOtherPhone] = useState("");
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

    initLiff("booking").then((state) => {
      if (cancelled) return;
      setLiffState(state);
      /*
       * 先問「綁了沒」。沒綁的人會被擋在綁定表單前面，綁完才看得到預約表單。
       *
       * 綁定之後姓名、電話、生日就是會員資料，這裡只負責帶出來，不給改——
       * 每次預約都能改的話，同一個人會留下三種寫法的姓名與電話，
       * 店家事後根本對不出那是不是同一個人。要改請聯絡店家。
       */
      if (state.kind !== "ready") { setChecked(true); return; }
      fetchMe(state.viewer.accessToken)
        .then((me) => {
          if (cancelled) return;
          applyMember(me.member);
        })
        .catch((e: Error) => !cancelled && setLoadErr(e.message))
        .finally(() => !cancelled && setChecked(true));
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

  /** 把會員資料填進表單。綁定完成與一開頁查到既有會員都走這裡 */
  function applyMember(m: MyProfile | null) {
    setMember(m);
    if (!m) return;
    setName(m.name);
    setPhone(m.phone);
    setBirthday(m.birthday ?? "");
  }

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

    // 幫別人訂的時候，要檢查的是對方那兩欄，生日不問
    const who = forOther ? otherName : name;
    const tel = forOther ? otherPhone : phone;

    if (!type) return setFormErr("請選擇預約身分");
    if (!who.trim()) return setFormErr(forOther ? "請填對方的姓名" : "請填姓名");
    if (!tel.trim()) return setFormErr(forOther ? "請填對方的聯絡電話" : "請填聯絡電話");
    if (!isValidPhone(tel)) return setFormErr(PHONE_RULE_MSG);
    if (!forOther) {
      if (!birthday) return setFormErr("請填生日");
      const bErr = birthdayError(birthday);
      if (bErr) return setFormErr(bErr);
    }
    if (twoPeople && !name2.trim()) return setFormErr("請填第二位的姓名");
    if (!date) return setFormErr("請選擇日期");
    if (!time) return setFormErr("請選擇時間");

    if (liffState?.kind !== "ready") {
      return setFormErr("尚未取得 LINE 身分，請從 LINE 裡開啟這個頁面");
    }

    setSubmitting(true);
    try {
      await submitBooking(liffState.viewer.accessToken, {
        type, name: who.trim(), phone: tel.trim(), birthday,
        forOther,
        name2: twoPeople ? name2.trim() : null,
        date, time,
        remark: remark.trim() || null,
      });
      setDone({
        date, time, type,
        who: twoPeople ? `${who.trim()}、${name2.trim()}` : who.trim(),
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
          <button onClick={closeLiffWindow}>✖️ 關閉</button>
          <button
            className="ghost"
            onClick={() => { setDone(null); setDate(""); setTime(""); setRemark(""); reloadAvailability(); }}
          >
            ➕ 再預約一筆
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

  /*
   * 綁定關卡：還沒綁的人看不到預約表單。
   *
   * 擺在載入畫面之後，是因為要等後端回答「綁了沒」才能判定；
   * 沒問過就先畫綁定表單的話，老客人每次開頁都會閃一下那張表。
   */
  if (checked && liffState?.kind === "ready" && !member) {
    return (
      <div className="wrap narrow">
        <Brand store={store} />
        <RegisterForm
          accessToken={liffState.viewer.accessToken}
          onDone={applyMember}
        />
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

        <label className="toggle" style={{ marginBottom: "1rem" }}>
          <input
            type="checkbox"
            checked={forOther}
            onChange={(e) => setForOther(e.target.checked)}
          />
          這筆是幫別人訂的
        </label>

        {forOther ? (
          <>
            {/*
              * 幫別人訂：填對方的姓名電話，只當成這筆預約的資料，
              * 不會變成會員、也不會動到自己的資料。
              */}
            <div className="field">
              <label htmlFor="o-name">對方的姓名</label>
              <input
                id="o-name" value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder="請填對方的真實姓名"
              />
            </div>
            <div className="field">
              <label htmlFor="o-phone">對方的聯絡電話</label>
              <input
                id="o-phone" value={otherPhone}
                onChange={(e) => setOtherPhone(e.target.value)}
                type="tel" inputMode="tel" maxLength={16}
                placeholder="0912345678"
              />
              <p className="hint">
                通知會發到<b>您的</b> LINE，這筆預約也會出現在您的「我的預約」裡，
                要改或取消都由您操作。
              </p>
            </div>
          </>
        ) : (
          <>
            {/*
              * 姓名、電話、生日是綁定時留下的會員資料，這裡只顯示不給改。
              * 每次預約都能改的話，同一個人會留下好幾種寫法的姓名與電話，
              * 店家事後對不出那是不是同一個人。
              */}
            <div className="field">
              <label htmlFor="name">姓名</label>
              <input id="name" value={name} disabled />
            </div>

            <div className="field">
              <label htmlFor="birthday">生日</label>
              {/*
                * 會員資料裡本來就有生日才鎖住。
                *
                * 綁定之前建的舊會員有可能沒填過生日，那種情況要讓他補——
                * 鎖住又必填會直接卡死，客人連預約都送不出去。
                */}
              <input
                id="birthday" type="date" value={birthday}
                disabled={Boolean(member?.birthday)}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="phone">聯絡電話</label>
              <input id="phone" value={phone} type="tel" disabled />
              <p className="hint">姓名、電話、生日是您綁定時留下的資料，需要修改請聯絡店家。</p>
            </div>
          </>
        )}

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
        {submitting ? "⏳ 送出中…" : "✅ 送出預約"}
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
