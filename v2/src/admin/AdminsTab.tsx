import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

interface AdminRow {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

/**
 * 權限管理
 *
 * 名單本身是 store_admins，但信箱在 auth.users——那張表不開放給登入者查
 * （否則任何店員都能撈出整個專案的信箱）。所以這裡一律走資料庫函式，
 * 權限檢查寫在函式內部，前端只是呼叫者。見 0007_admin_management.sql。
 */
export default function AdminsTab({ store, myUserId }: { store: Store; myUserId: string }) {
  const [rows, setRows] = useState<AdminRow[] | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");

  const load = useCallback(async () => {
    setErr("");
    const { data, error } = await supabase.rpc("list_store_admins", { p_store_id: store.id });
    if (error) setErr(error.message);
    else setRows((data ?? []) as AdminRow[]);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  async function add() {
    if (busy) return;                        // 防連點
    const mail = email.trim();
    if (!mail) return setErr("請填要加入的信箱");

    setBusy("add"); setErr(""); setOk("");
    const { error } = await supabase.rpc("add_store_admin", {
      p_store_id: store.id,
      p_email: mail,
      p_role: role,
    });
    if (error) {
      setErr(error.message);
    } else {
      setOk(`已將 ${mail} 加入名單`);
      setEmail("");
      await load();
    }
    setBusy(null);
  }

  async function remove(row: AdminRow) {
    if (busy) return;
    if (!confirm(`確定要把 ${row.email} 從名單移除嗎？\n移除後他就進不了後台。`)) return;

    setBusy(row.user_id); setErr(""); setOk("");
    const { error } = await supabase.rpc("remove_store_admin", {
      p_store_id: store.id,
      p_user_id: row.user_id,
    });
    if (error) {
      setErr(error.message);
    } else {
      setOk(`已移除 ${row.email}`);
      await load();
    }
    setBusy(null);
  }

  async function changeRole(row: AdminRow, next: string) {
    if (busy) return;
    if (!confirm(`確定要把 ${row.email} 改成${next === "owner" ? "負責人" : "店員"}嗎？`)) return;

    setBusy(row.user_id); setErr(""); setOk("");
    // 加人跟改角色是同一支函式：已經在名單裡就只更新角色
    const { error } = await supabase.rpc("add_store_admin", {
      p_store_id: store.id,
      p_email: row.email,
      p_role: next,
    });
    if (error) setErr(error.message);
    else { setOk(`${row.email} 已改為${next === "owner" ? "負責人" : "店員"}`); await load(); }
    setBusy(null);
  }

  return (
    <>
      <div className="panel">
        <div className="panel-title">加入管理員</div>
        <p className="sub" style={{ marginBottom: 14 }}>
          對方要<b>先自己到這個後台網址註冊一次</b>，你才加得進來——
          這裡不會幫別人建帳號，密碼只能由本人設定。
        </p>

        <div className="filters">
          <div className="f grow">
            <label htmlFor="ae">信箱</label>
            <input
              id="ae" type="email" value={email} autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="對方註冊時用的信箱"
            />
          </div>
          <div className="f">
            <label htmlFor="ar">身分</label>
            <select id="ar" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">店員</option>
              <option value="owner">負責人</option>
            </select>
          </div>
        </div>

        <button disabled={busy === "add"} onClick={add}>
          {busy === "add" ? "⏳ 加入中…" : "➕ 加入名單"}
        </button>

        <p className="hint">
          <b>店員</b>：可以管預約和會員、設定營業日。<br />
          <b>負責人</b>：以上全部，另外可以改營業時間、管理這份名單。
        </p>
      </div>

      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}

      {rows === null && <div className="panel"><div className="skeleton" style={{ height: 64 }} /></div>}

      {rows && (
        <>
          <p className="sub" style={{ margin: "0 0 10px" }}>目前 {rows.length} 人</p>
          <div className="rows">
            {rows.map((r) => {
              const isMe = r.user_id === myUserId;
              return (
                <div className="arow" key={r.user_id}>
                  <div className="c who" data-label="信箱">
                    <b style={{ wordBreak: "break-all" }}>{r.email}</b>
                    {isMe && <span className="tag2">你自己</span>}
                  </div>

                  <div className="c" data-label="身分">
                    <span className={"badge " + (r.role === "owner" ? "up" : "old")}>
                      {r.role === "owner" ? "負責人" : "店員"}
                    </span>
                  </div>

                  <div className="c acts">
                    <button
                      className="slim outline" disabled={busy === r.user_id}
                      onClick={() => changeRole(r, r.role === "owner" ? "staff" : "owner")}
                    >
                      🔁 改成{r.role === "owner" ? "店員" : "負責人"}
                    </button>
                    <button
                      className="slim outline danger" disabled={busy === r.user_id}
                      onClick={() => remove(r)}
                    >
                      🗑️ 移除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
