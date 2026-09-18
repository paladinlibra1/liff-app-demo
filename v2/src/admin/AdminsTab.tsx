import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

interface AdminRow {
  user_id: string;
  email: string;
  role: string;
  created_at: string;
}

/** 已經註冊、但還不在這家店名單裡的人 */
interface PendingRow {
  user_id: string;
  email: string;
  created_at: string;
}

/** 被移除或被忽略的人。記著才不會一直跳回待審核 */
interface DeniedRow {
  user_id: string;
  email: string;
  denied_at: string;
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
  const [pending, setPending] = useState<PendingRow[] | null>(null);
  const [denied, setDenied] = useState<DeniedRow[]>([]);
  const [showDenied, setShowDenied] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");

  const load = useCallback(async () => {
    setErr("");
    const [a, p, d] = await Promise.all([
      supabase.rpc("list_store_admins", { p_store_id: store.id }),
      supabase.rpc("list_pending_users", { p_store_id: store.id }),
      supabase.rpc("list_denied_users", { p_store_id: store.id }),
    ]);
    if (a.error) { setErr(a.error.message); return; }
    setRows((a.data ?? []) as AdminRow[]);
    // 這兩份只有負責人查得到；不是負責人本來就看不到這個分頁，
    // 真的出錯也不該擋住上面的名單
    setPending(p.error ? [] : ((p.data ?? []) as PendingRow[]));
    setDenied(d.error ? [] : ((d.data ?? []) as DeniedRow[]));
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

  /** 通過待審核的人。底層跟手動加人是同一支函式，只是信箱不用自己打 */
  async function approve(row: PendingRow, asRole: string) {
    if (busy) return;                        // 防連點
    setBusy(row.user_id); setErr(""); setOk("");
    const { error } = await supabase.rpc("add_store_admin", {
      p_store_id: store.id,
      p_email: row.email,
      p_role: asRole,
    });
    if (error) setErr(error.message);
    else { setOk(`已通過 ${row.email}（${asRole === "owner" ? "負責人" : "店員"}）`); await load(); }
    setBusy(null);
  }

  /** 忽略：不通過，而且以後不要再出現在待審核 */
  async function deny(row: PendingRow) {
    if (busy) return;                        // 防連點
    setBusy(row.user_id); setErr(""); setOk("");
    const { error } = await supabase.rpc("deny_store_user", {
      p_store_id: store.id, p_user_id: row.user_id,
    });
    if (error) setErr(error.message);
    else { setOk(`已忽略 ${row.email}，不會再出現在待審核`); await load(); }
    setBusy(null);
  }

  /** 收回忽略，讓他回到待審核（按錯了要救得回來） */
  async function undeny(row: DeniedRow) {
    if (busy) return;
    setBusy(row.user_id); setErr(""); setOk("");
    const { error } = await supabase.rpc("undeny_store_user", {
      p_store_id: store.id, p_user_id: row.user_id,
    });
    if (error) setErr(error.message);
    else { setOk(`${row.email} 已放回待審核`); await load(); }
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
      {pending && pending.length > 0 && (
        <div className="panel">
          <div className="panel-title">🔔 等待通過（{pending.length}）</div>
          <p className="sub" style={{ marginBottom: 14 }}>
            這些人已經註冊過了，但還沒被加入名單，所以進來只會看到「帳號尚未授權」。
            確認是你認識的人再按通過。
          </p>

          <div className="rows">
            {pending.map((r) => (
              <div className="arow" key={r.user_id}>
                <div className="c who" data-label="信箱">
                  <b style={{ wordBreak: "break-all" }}>{r.email}</b>
                  <div className="sub" style={{ margin: "0.1875rem 0 0" }}>
                    註冊於 {new Date(r.created_at).toLocaleString("zh-TW", { hour12: false })}
                  </div>
                </div>
                <div className="c acts">
                  <button
                    className="slim" disabled={busy === r.user_id}
                    onClick={() => approve(r, "staff")}
                  >
                    {busy === r.user_id ? "⏳ 處理中…" : "✅ 通過（店員）"}
                  </button>
                  <button
                    className="slim outline" disabled={busy === r.user_id}
                    onClick={() => approve(r, "owner")}
                  >
                    👑 通過（負責人）
                  </button>
                  <button
                    className="slim outline danger" disabled={busy === r.user_id}
                    onClick={() => deny(r)}
                  >
                    🚫 忽略
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="hint">
            不認識的人按「忽略」，他就不會再出現在這裡（也一樣進不了後台）。
            要徹底刪掉那個帳號要到 Supabase 的 Authentication → Users。
          </p>
        </div>
      )}

      <div className="panel">
        <div className="panel-title">手動加入（對方註冊過就會自己出現在上面，通常用不到）</div>
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

      {denied.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            🚫 已忽略（{denied.length}）
            <button className="linkish" onClick={() => setShowDenied(!showDenied)}>
              {showDenied ? "收合" : "展開"}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            被你移除或忽略的人。他們不會再出現在「等待通過」，也進不了後台。
          </p>

          {showDenied && (
            <div className="rows">
              {denied.map((r) => (
                <div className="arow" key={r.user_id}>
                  <div className="c who" data-label="信箱">
                    <b style={{ wordBreak: "break-all" }}>{r.email}</b>
                    <div className="sub" style={{ margin: "0.1875rem 0 0" }}>
                      {new Date(r.denied_at).toLocaleString("zh-TW", { hour12: false })}
                    </div>
                  </div>
                  <div className="c acts">
                    <button
                      className="slim outline" disabled={busy === r.user_id}
                      onClick={() => undeny(r)}
                    >
                      ↩️ 放回待審核
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
