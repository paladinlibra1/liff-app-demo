import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { apiUrl, pageUrl } from "../lib/storePath";

/**
 * LINE／IG 的內建瀏覽器裡 Google OAuth 開不起來（Google 直接擋第三方 WebView），
 * 所以那種情況不顯示 Google 按鈕，只留信箱密碼。舊系統踩過同一個坑。
 */
function inAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /\bLine\b|Instagram|FBAN|FBAV/i.test(ua);
}

export default function Login() {
  /*
   * 店名。
   *
   * 登入畫面拿不到 stores 那一列——那是登入之後才讀得到的（RLS 擋著），
   * 所以跟客人端一樣打公開的 /api/store。那支本來就給還沒登入的人用。
   *
   * 拿不到就顯示「後台」，不要讓一個標題擋住登入。
   */
  const [storeName, setStoreName] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/store"))
      .then((r) => r.json() as Promise<{ name?: string }>)
      .then((d) => { if (!cancelled && d.name) setStoreName(d.name); })
      .catch(() => { /* 沒有店名照樣能登入 */ });
    return () => { cancelled = true; };
  }, []);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [canGoogle] = useState(() => !inAppBrowser());

  /**
   * Google 登入。
   *
   * 走轉址：Google →（Supabase 的 callback）→ 回到 /admin，
   * 回來時 supabase-js 會自己把網址上的 token 收進 session，
   * onAuthStateChange 接手，所以這裡成功之後什麼都不用做。
   *
   * 第一次用 Google 進來的人等於剛註冊，還不在店家名單裡，
   * 會看到「尚未授權」，要負責人在「🔑 權限管理」的待審核名單按通過。
   */
  async function google() {
    if (busy) return;                     // 防連點
    setBusy(true); setErr(""); setInfo("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // 回到同一家店的後台：/madou/admin 進去就要回 /madou/admin
      options: { redirectTo: window.location.origin + pageUrl("/admin") },
    });
    // 沒出錯的話瀏覽器已經在跳轉了，不用解鎖
    if (error) {
      setErr(translate(error.message));
      setBusy(false);
    }
  }

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
        <h1>{storeName ? `${storeName} 後台` : "後台"}</h1>
        <p className="sub">
          {mode === "signin" ? "請登入以繼續。" : "建立帳號後，還需要管理員把你加入店家名單才看得到資料。"}
        </p>

        {canGoogle && (
          <>
            <button className="outline gbtn" style={{ marginTop: 0 }} disabled={busy} onClick={google}>
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.8 6.1C12.2 13.3 17.6 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v8.1h12.6c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.5-10.2 6.5-17.2z" />
                <path fill="#FBBC05" d="M10.3 28.7a14.7 14.7 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
                <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.6-5.6l-7.6-5.9c-2 1.4-4.7 2.4-8 2.4-6.4 0-11.8-3.8-13.7-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              使用 Google 帳號登入
            </button>
            <p className="hint" style={{ textAlign: "center" }}>或用信箱密碼登入</p>
          </>
        )}

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
            {busy ? "⏳ 處理中…" : mode === "signin" ? "🔑 登入" : "✨ 建立帳號"}
          </button>
        </form>

        <button
          className="ghost"
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setInfo(""); }}
        >
          {mode === "signin" ? "✨ 還沒有帳號？建立一個" : "↩️ 已經有帳號了，回到登入"}
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
