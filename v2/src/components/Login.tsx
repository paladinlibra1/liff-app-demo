import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;           // 防連點：送出期間鎖住
    setBusy(true);
    setErr("");
    setInfo("");

    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // 成功後 onAuthStateChange 會接手，這裡不用做事
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          setInfo("註冊成功，正在進入…");
        } else {
          setInfo("註冊成功，請到信箱點擊確認信之後再回來登入。");
        }
      }
    } catch (e: any) {
      setErr(translate(e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card">
        <h1>潮州店 後台</h1>
        <p className="sub">
          {mode === "signin" ? "請登入以繼續。" : "建立帳號後，還需要管理員把你加入店家名單才看得到資料。"}
        </p>

        <form onSubmit={submit}>
          <label htmlFor="email">電子信箱</label>
          <input
            id="email" type="email" value={email} autoComplete="email" required
            onChange={(e) => setEmail(e.target.value)}
          />

          <label htmlFor="pw">密碼</label>
          <input
            id="pw" type="password" value={password} required minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" disabled={busy}>
            {busy ? "處理中…" : mode === "signin" ? "登入" : "建立帳號"}
          </button>
        </form>

        <button
          className="ghost"
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setInfo(""); }}
        >
          {mode === "signin" ? "還沒有帳號？建立一個" : "已經有帳號了，回到登入"}
        </button>

        {err && <div className="msg err">{err}</div>}
        {info && <div className="msg ok">{info}</div>}
      </div>
    </div>
  );
}

/** Supabase 的錯誤訊息是英文，挑常見的翻成中文 */
function translate(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return "信箱或密碼不正確。";
  if (/Email not confirmed/i.test(msg)) return "信箱尚未確認，請先去收確認信。";
  if (/User already registered/i.test(msg)) return "這個信箱已經註冊過了，直接登入即可。";
  if (/Password should be at least/i.test(msg)) return "密碼太短，至少要 6 個字元。";
  if (/rate limit|too many/i.test(msg)) return "嘗試次數太多，請稍等一下再試。";
  return msg;
}
