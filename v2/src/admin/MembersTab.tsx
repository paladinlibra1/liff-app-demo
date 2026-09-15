import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { normalizePhone, isValidPhone, PHONE_RULE_MSG } from "../shared/phone";
import type { Store } from "./AdminShell";

interface MemberRow {
  id: string;
  name: string;
  phone: string;
  birthday: string | null;
  referrer: string | null;
  note: string | null;
  guardian_id: string | null;
  /** 身分：null 表示一般客人 */
  role: string | null;
  line_user_id: string | null;
  line_name: string | null;
  created_at: string;
}

const FIELDS =
  "id,name,phone,birthday,referrer,note,guardian_id,role,line_user_id,line_name,created_at";

/**
 * 會員身分。沿用舊系統：空白＝一般客人，其餘三種是自己人。
 * 報表要把自己人排除掉，所以這不只是個標籤，是會影響數字的欄位。
 */
const ROLES = ["店家", "助理", "夥伴"];

/** 空字串要存成 null，不然日期欄位會被 Postgres 退回 */
const orNull = (v: string) => (v.trim() ? v.trim() : null);

/**
 * 生日的合理範圍。沿用舊系統：5 歲以下、95 歲以上一律當成填錯——
 * 最常見的是把民國年打成西元年（民國 80 年打成 1980）。
 */
const AGE_MIN = 5;
const AGE_MAX = 95;

function ageOf(birthday: string): number | null {
  const d = new Date(birthday + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

export default function MembersTab({ store }: { store: Store }) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  /** 正在刪除的那一筆 id，用來鎖住按鈕防連點 */
  const [deleting, setDeleting] = useState<string | null>(null);

  /** null = 沒在編輯；物件 = 正在編輯（沒有 id 就是新增） */
  const [editing, setEditing] = useState<Partial<MemberRow> | null>(null);

  /**
   * 可以當監護人的人選：只列「已綁定 LINE」的會員。
   * 監護人的用途就是替未成年收通知，沒綁 LINE 的人當監護人等於沒設。
   * 跟搜尋結果分開讀，才不會因為搜尋而少了人選。
   */
  const [guardians, setGuardians] = useState<MemberRow[]>([]);

  const load = useCallback(async () => {
    setErr("");
    let q = supabase
      .from("members")
      .select(FIELDS)
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(300);

    const kw = keyword.trim();
    if (kw) {
      // 姓名或電話，有一個對上就算。電話先正規化，這樣搜尋「0912-345-678」也找得到
      const phone = normalizePhone(kw);
      q = q.or(`name.ilike.%${kw}%,phone.ilike.%${phone}%`);
    }

    const { data, error } = await q;
    if (error) setErr(error.message);
    else setRows(data as MemberRow[]);
  }, [store.id, keyword]);

  const loadGuardians = useCallback(async () => {
    const { data } = await supabase
      .from("members")
      .select(FIELDS)
      .eq("store_id", store.id)
      .not("line_user_id", "is", null)
      .order("name");
    setGuardians((data ?? []) as MemberRow[]);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadGuardians(); }, [loadGuardians]);

  /** id → 姓名，清單要顯示監護人是誰 */
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of guardians) m.set(g.id, g.name);
    for (const r of rows ?? []) m.set(r.id, r.name);
    return m;
  }, [guardians, rows]);

  async function save() {
    if (saving || !editing) return;          // 防連點
    setErr("");

    const name = (editing.name ?? "").trim();
    const phone = (editing.phone ?? "").trim();
    const birthday = (editing.birthday ?? "").trim();

    if (!name) return setErr("請填會員姓名");
    if (!isValidPhone(phone)) return setErr(PHONE_RULE_MSG);

    if (birthday) {
      const age = ageOf(birthday);
      if (age === null) return setErr("生日格式不正確");
      if (age <= AGE_MIN || age >= AGE_MAX) {
        return setErr(
          `生日不合理：${birthday} 換算是 ${age} 歲。` +
          `年齡要介於 ${AGE_MIN + 1} 到 ${AGE_MAX - 1} 歲之間，` +
          `請確認是不是把民國年打成西元年了。`,
        );
      }
    }

    setSaving(true);
    const payload = {
      store_id: store.id,
      name,
      phone: normalizePhone(phone),
      birthday: orNull(birthday),
      referrer: orNull(editing.referrer ?? ""),
      note: orNull(editing.note ?? ""),
      guardian_id: editing.guardian_id || null,
      // 空字串代表「客人」，資料庫存 null
      role: editing.role || null,
    };

    // 帶 .select()：被 RLS 擋下的寫入不會回錯誤，只會回 0 列（見 OperatingDaysTab 的說明）
    const { data, error } = editing.id
      ? await supabase.from("members").update(payload).eq("id", editing.id).select("id")
      : await supabase.from("members").insert(payload).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功，請確認你的帳號權限。");
    } else {
      setEditing(null);
      await load();
      await loadGuardians();
    }
    setSaving(false);
  }

  /**
   * 刪除會員。
   *
   * 預約紀錄不會跟著消失：bookings.member_id 是 on delete set null，
   * 而且單子上的姓名電話是下單當時的快照，所以歷史與報表都還讀得到。
   */
  async function remove(m: MemberRow) {
    if (deleting || saving) return;          // 防連點
    if (!confirm(
      `確定要刪除會員「${m.name}」嗎？

` +
      `他過去的預約紀錄會保留，但會員資料會消失，無法復原。`,
    )) return;

    setDeleting(m.id); setErr("");

    // 一樣要帶 .select()：被 RLS 擋下的刪除不會回錯誤，只會回 0 列
    const { data, error } = await supabase
      .from("members").delete().eq("id", m.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有刪除成功，請確認你的帳號權限。");
    } else {
      // 正在編輯的就是被刪掉的那位 → 把表單收起來，免得存回一筆幽靈資料
      if (editing?.id === m.id) setEditing(null);
      await load();
      await loadGuardians();
    }
    setDeleting(null);
  }

  return (
    <>
      <div className="panel">
        <div className="filters">
          <div className="f grow">
            <label htmlFor="kw">搜尋</label>
            <input
              id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="會員姓名或聯絡電話"
            />
          </div>
        </div>
        <button className="slim" style={{ marginTop: 12 }} onClick={() => setEditing({})}>
          ➕ 新增會員
        </button>
      </div>

      {editing && (
        <div className="panel">
          <div className="panel-title">{editing.id ? "編輯會員" : "新增會員"}</div>

          <div className="field">
            <label>會員姓名</label>
            <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>

          <div className="field">
            <label>聯絡電話</label>
            <input
              value={editing.phone ?? ""} type="tel" inputMode="tel"
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
            />
          </div>

          <div className="field">
            <label>身分</label>
            <select
              value={editing.role ?? ""}
              onChange={(e) => setEditing({ ...editing, role: e.target.value || null })}
            >
              <option value="">客人</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="hint">
              店家／助理／夥伴不算真實客人，之後的報表會把他們排除掉。一般客人選「客人」就好。
            </p>
          </div>

          <div className="field">
            <label>生日（可不填）</label>
            <input
              type="date" value={editing.birthday ?? ""}
              onChange={(e) => setEditing({ ...editing, birthday: e.target.value })}
            />
          </div>

          <div className="field">
            <label>介紹人（可不填）</label>
            <input value={editing.referrer ?? ""} onChange={(e) => setEditing({ ...editing, referrer: e.target.value })} />
          </div>

          <div className="field">
            <label>監護人（未成年才需要）</label>
            <select
              value={editing.guardian_id ?? ""}
              onChange={(e) => setEditing({ ...editing, guardian_id: e.target.value || null })}
            >
              <option value="">不設定</option>
              {guardians
                .filter((g) => g.id !== editing.id)   // 不能把自己設成自己的監護人
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.phone}）
                  </option>
                ))}
            </select>
            <p className="hint">
              設定之後，這位會員的預約通知會改發給監護人的 LINE。
              只列得出已綁定 LINE 的會員——沒綁 LINE 的人當監護人等於沒設。
            </p>
          </div>

          <div className="field">
            <label>備註（可不填）</label>
            <textarea value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>

          {editing.id && editing.line_user_id && (
            <p className="hint">
              已綁定 LINE（暱稱：{editing.line_name || "未取得"}）。LINE 綁定不能從這裡改。
            </p>
          )}

          <button disabled={saving} onClick={save}>{saving ? "⏳ 儲存中…" : "💾 儲存"}</button>
          <button className="ghost" onClick={() => setEditing(null)}>↩️ 取消</button>
        </div>
      )}

      {err && <div className="msg err">{err}</div>}

      {rows === null && <div className="panel"><div className="skeleton" style={{ height: 64 }} /></div>}

      {rows && rows.length === 0 && (
        <div className="panel empty">
          <div className="emoji">👤</div>
          <p>{keyword ? "找不到符合的會員" : "還沒有會員資料"}</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <p className="sub" style={{ margin: "0 0 10px" }}>總人數：{rows.length} 人</p>
          <div className="rows">
            {/* 桌面版的表頭。手機上每個欄位自己帶標籤，不需要它，CSS 會藏起來 */}
            <div className="arow head" aria-hidden="true">
              <div className="c who">會員姓名</div>
              <div className="c">身分</div>
              <div className="c">來源</div>
              <div className="c">聯絡電話</div>
              <div className="c">生日</div>
              <div className="c">LINE 暱稱</div>
              <div className="c">介紹人</div>
              <div className="c">監護人</div>
              <div className="c acts">操作</div>
            </div>
            {rows.map((m) => (
              <div className="arow" key={m.id}>
                <div className="c who" data-label="會員姓名">
                  <b>{m.name}</b>
                </div>

                <div className="c" data-label="身分">
                  {m.role
                    ? <span className="badge up">{m.role}</span>
                    : "客人"}
                </div>

                <div className="c" data-label="來源">
                  {m.line_user_id
                    ? <span className="badge up">LINE 會員</span>
                    : <span className="badge old">手動建立</span>}
                </div>

                <div className="c" data-label="聯絡電話">
                  <a href={`tel:${m.phone}`}>{m.phone}</a>
                </div>

                <div className="c" data-label="生日">{m.birthday ?? "—"}</div>
                <div className="c" data-label="LINE 暱稱">{m.line_name || "—"}</div>
                <div className="c" data-label="介紹人">{m.referrer || "—"}</div>
                <div className="c" data-label="監護人">
                  {m.guardian_id ? (nameById.get(m.guardian_id) ?? "（已刪除）") : "—"}
                </div>

                {m.note && <div className="c note" data-label="備註">{m.note}</div>}

                <div className="c acts">
                  <button className="slim outline" onClick={() => setEditing(m)}>✏️ 編輯</button>
                  <button
                    className="slim outline danger"
                    disabled={deleting === m.id}
                    onClick={() => remove(m)}
                  >
                    {deleting === m.id ? "⏳ 刪除中…" : "🗑️ 刪除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
