import { useCallback, useEffect, useState } from "react";
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
  line_user_id: string | null;
  line_name: string | null;
  created_at: string;
}

/** 空字串要存成 null，不然日期欄位會被 Postgres 退回 */
const orNull = (v: string) => (v.trim() ? v.trim() : null);

export default function MembersTab({ store }: { store: Store }) {
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  /** null = 沒在編輯；物件 = 正在編輯（沒有 id 就是新增） */
  const [editing, setEditing] = useState<Partial<MemberRow> | null>(null);

  const load = useCallback(async () => {
    setErr("");
    let q = supabase
      .from("members")
      .select("id,name,phone,birthday,referrer,note,line_user_id,line_name,created_at")
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

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving || !editing) return;          // 防連點
    setErr("");

    const name = (editing.name ?? "").trim();
    const phone = (editing.phone ?? "").trim();
    if (!name) return setErr("請填姓名");
    if (!isValidPhone(phone)) return setErr(PHONE_RULE_MSG);

    setSaving(true);
    const payload = {
      store_id: store.id,
      name,
      phone: normalizePhone(phone),
      birthday: orNull(editing.birthday ?? ""),
      referrer: orNull(editing.referrer ?? ""),
      note: orNull(editing.note ?? ""),
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
    }
    setSaving(false);
  }

  return (
    <>
      <div className="panel">
        <div className="filters">
          <div className="f grow">
            <label htmlFor="kw">搜尋</label>
            <input
              id="kw" value={keyword} onChange={(e) => setKeyword(e.target.value)}
              placeholder="姓名或電話"
            />
          </div>
        </div>
        <button className="slim" style={{ marginTop: 12 }} onClick={() => setEditing({})}>
          ＋ 新增會員
        </button>
      </div>

      {editing && (
        <div className="panel">
          <div className="panel-title">{editing.id ? "編輯會員" : "新增會員"}</div>

          <div className="field">
            <label>姓名</label>
            <input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="field">
            <label>電話</label>
            <input
              value={editing.phone ?? ""} type="tel" inputMode="tel"
              onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
            />
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
            <label>備註（可不填）</label>
            <textarea value={editing.note ?? ""} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
          </div>

          {editing.id && editing.line_user_id && (
            <p className="hint">
              已綁定 LINE（{editing.line_name || "未取得暱稱"}）。LINE 綁定不能從這裡改。
            </p>
          )}

          <button disabled={saving} onClick={save}>{saving ? "儲存中…" : "儲存"}</button>
          <button className="ghost" onClick={() => setEditing(null)}>取消</button>
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
          <p className="sub" style={{ margin: "0 0 10px" }}>共 {rows.length} 位</p>
          <div className="rows">
            {rows.map((m) => (
              <div className="arow" key={m.id}>
                <div className="c who" data-label="姓名">
                  <b>{m.name}</b>
                  {m.line_user_id
                    ? <span className="tag2 line">LINE</span>
                    : <span className="tag2">手動建立</span>}
                </div>
                <div className="c" data-label="電話">
                  <a href={`tel:${m.phone}`}>{m.phone}</a>
                </div>
                <div className="c" data-label="生日">{m.birthday ?? "—"}</div>
                {m.note && <div className="c note" data-label="備註">{m.note}</div>}
                <div className="c acts">
                  <button className="slim outline" onClick={() => setEditing(m)}>編輯</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
