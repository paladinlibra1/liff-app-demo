import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { normalizePhone, isValidPhone, PHONE_RULE_MSG } from "../shared/phone";
import type { Store } from "./AdminShell";

/**
 * 代客預約（店家幫客人訂）
 *
 * 舊系統的做法是開一個 `index.html?role=admin` 的新分頁，讓店員用客人端
 * 那張表單填。v2 的客人端是 LIFF，在瀏覽器裡開不起來，所以改成後台自己的表單。
 *
 * 規則跟客人端一樣：只選得到「有營業、沒被封鎖、還有位子」的時段。
 * 要排店休日的單，請先去營業日設定把那天打開——讓後台能繞過規則，
 * 客人端算出來的「剩幾位」就會跟事實對不起來。
 *
 * 時段是跟 Worker 的 /api/availability 要的，跟客人看到的是同一份資料，
 * 不另外在後台重算一次；真正的把關在資料庫的 check_slot_capacity() trigger。
 *
 * 建立走 `/api/admin/bookings` 而不是直接寫 Supabase——推播的 token 只存在
 * Worker，不經過它就發不了 LINE。通知對象由 Worker 自己從會員解析，
 * 前端只送 memberId：前端能指定「通知發給誰」的話，
 * 等於能拿這支 API 發 LINE 給任意使用者。
 */

/** 沿用舊系統 index.html 的三種預約身分 */
const TYPES = ["新客體驗", "一般預約", "複檢"];

interface MemberHit {
  id: string;
  name: string;
  phone: string;
  line_user_id: string | null;
  guardian_id: string | null;
}

interface Slot {
  time: string;
  remaining: number;
}

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

export default function NewBookingForm({
  store, onSaved, onClose,
}: {
  store: Store;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [member, setMember] = useState<MemberHit | null>(null);

  const [name, setName] = useState("");
  const [name2, setName2] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("");
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState("");
  const [remark, setRemark] = useState("");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [dayOpen, setDayOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ── 找會員 ────────────────────────────────────────
  // 沒有會員也能訂（電話客），所以這一段是選填的。
  useEffect(() => {
    const kw = keyword.trim();
    if (!kw) { setHits([]); return; }

    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("members")
        .select("id,name,phone,line_user_id,guardian_id")
        .eq("store_id", store.id)
        .or(`name.ilike.%${kw}%,phone.ilike.%${normalizePhone(kw)}%`)
        .limit(8);
      if (!cancelled) setHits((data ?? []) as MemberHit[]);
    }, 250);   // 打字打到一半就送查詢會把資料庫打爆

    return () => { cancelled = true; clearTimeout(t); };
  }, [keyword, store.id]);

  function pick(m: MemberHit) {
    setMember(m);
    setName(m.name);
    setPhone(m.phone);
    setKeyword("");
    setHits([]);
  }

  // ── 那一天有哪些時段 ──────────────────────────────
  const loadSlots = useCallback(async () => {
    if (!date) return;
    setSlots(null);
    try {
      const res = await fetch(`/api/availability?from=${date}&to=${date}`);
      const body = await res.json() as { days?: { isOperating: boolean; slots: Slot[] }[] };
      const day = body.days?.[0];
      setDayOpen(Boolean(day?.isOperating));
      setSlots(day?.slots ?? []);
    } catch {
      setErr("讀取時段失敗，請稍後再試");
      setSlots([]);
    }
  }, [date]);

  useEffect(() => { void loadSlots(); }, [loadSlots]);
  // 換日期時清掉已選時段，不然會留著前一天選的那個時間送出去
  useEffect(() => { setTime(""); }, [date]);

  async function save() {
    if (busy) return;                                  // 防連點
    setErr("");

    if (!name.trim()) return setErr("請填預約人姓名");
    if (!isValidPhone(phone)) return setErr(PHONE_RULE_MSG);
    if (!type) return setErr("請選擇預約身分");
    if (!date) return setErr("請選日期");
    if (!time) return setErr("請選時段");

    setBusy(true);

    // Worker 要用這個 token 確認「你是這家店的後台人員」
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) {
      setErr("登入已過期，請重新登入後台");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          memberId: member?.id ?? null,
          name: name.trim(),
          name2: name2.trim() || null,
          phone: normalizePhone(phone),
          type,
          date,
          time,
          remark: remark.trim() || null,
        }),
      });

      // Worker 的錯誤一律是 { error: "人看得懂的句子" }，直接顯示
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) {
        setErr(body?.error || `建立失敗（${res.status}），請稍後再試`);
      } else {
        await onSaved();
        onClose();
      }
    } catch {
      setErr("連線失敗，請確認網路狀態後再試一次");
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="panel-title">代客預約</div>

      {/* ── 會員 ── */}
      <div className="field">
        <label>會員（可不選）</label>
        {member ? (
          <div className="picked">
            <span>
              <b>{member.name}</b>　{member.phone}
              {member.line_user_id
                ? <span className="tag2 line">有 LINE</span>
                : <span className="tag2">沒綁 LINE</span>}
            </span>
            <button className="slim outline" onClick={() => setMember(null)}>✖️ 取消選擇</button>
          </div>
        ) : (
          <>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="輸入姓名或電話搜尋會員"
            />
            {hits.length > 0 && (
              <div className="hits">
                {hits.map((m) => (
                  <button key={m.id} className="slim outline" onClick={() => pick(m)}>
                    {m.name}（{m.phone}）
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <p className="hint">
          選了會員，通知與前一天的提醒才發得出去（綁了監護人就發給監護人），
          客人自己的「我的預約」也才看得到這一筆。沒選的話系統會自動用電話對一次，
          對得到就一樣接得上。
          <br />電話客可以不選，直接往下填姓名電話。
        </p>
      </div>

      {/* ── 基本資料 ── */}
      <div className="filters">
        <div className="f">
          <label htmlFor="nb-name">預約人姓名</label>
          <input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="f">
          <label htmlFor="nb-phone">聯絡電話</label>
          <input
            id="nb-phone" type="tel" inputMode="tel"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label>預約身分</label>
        <div className="seg">
          {TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="nb-name2">同行第二人（可不填）</label>
        <input id="nb-name2" value={name2} onChange={(e) => setName2(e.target.value)} />
        <p className="hint">填了就佔 2 個位子，跟客人端的規則一樣。</p>
      </div>

      {/* ── 日期與時段 ── */}
      <div className="field">
        <label htmlFor="nb-date">日期</label>
        <input id="nb-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field">
        <label>時段</label>
        {slots === null && <div className="skeleton" style={{ height: "3rem" }} />}

        {slots !== null && !dayOpen && (
          <p className="hint">
            這一天沒有營業，所以沒有時段可選。
            要排這天的單，請先到「📅 營業日設定」把它設為營業。
          </p>
        )}

        {slots !== null && dayOpen && slots.length === 0 && (
          <p className="hint">這一天的時段全被封鎖或已額滿。</p>
        )}

        {slots !== null && dayOpen && slots.length > 0 && (
          <div className="slots">
            {slots.map((s) => (
              <button
                key={s.time} type="button" className="slot"
                disabled={s.remaining <= 0}
                aria-pressed={time === s.time}
                onClick={() => setTime(s.time)}
              >
                {s.time}
                <span className="left">
                  {s.remaining <= 0 ? "額滿" : `剩 ${s.remaining} 位`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="nb-remark">備註（可不填）</label>
        <textarea id="nb-remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>

      {err && <div className="msg err">{err}</div>}

      <button disabled={busy} onClick={save}>{busy ? "⏳ 建立中…" : "✅ 建立預約"}</button>
      <button className="ghost" onClick={onClose}>↩️ 取消</button>

      <p className="hint">
        選了有綁 LINE 的會員，建立後會立刻發 LINE 通知給客人
        （綁了監護人就發給監護人）。沒選會員的電話客不會收到通知。
      </p>
    </div>
  );
}
