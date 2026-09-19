import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Login from "./Login";
import { applyTheme, themeFromRow } from "./theme";
import AdminShell from "./AdminShell";

/*
 * 店家那一列。型別定義在 AdminShell（畫面都從它拿），這裡直接沿用，
 * 不要各寫一份——欄位加減時會漏掉其中一邊。
 */
import type { Store } from "./AdminShell";
import { STORE_SLUG } from "../lib/storePath";

/** 登入狀態的三種可能：未登入 / 已登入但不在任何店的名單裡 / 已授權 */
export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [checking, setChecking] = useState(true);

  /*
   * 後台換成舊系統那套黑白灰。
   *
   * body 與 html 兩邊都要掛：
   *   body → 整頁底色（只套在容器上的話四周還是客人端的粉色）
   *   html → 後台縮到 90% 的根字級（rem 看的是根元素，掛 body 沒用）
   */
  useEffect(() => {
    document.body.classList.add("admin-theme");
    document.documentElement.classList.add("admin-theme");
    return () => {
      document.body.classList.remove("admin-theme");
      document.documentElement.classList.remove("admin-theme");
    };
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 有 session 之後，查這個人能管哪家店。
  // 這裡不需要自己比對名單——RLS 已經保證只查得到有權限的店，
  // 查回空的就是沒授權。
  useEffect(() => {
    if (!session) {
      setStore(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    /*
     * 網址帶了店名就查那一家（`/madou/admin`）；沒帶就拿查得到的第一家。
     * 不用自己比對權限——RLS 保證只查得到自己在名單裡的店，
     * 查回空的就是沒授權，畫面會顯示「尚未授權」。
     */
    let q = supabase
      .from("stores")
      .select("id, name, slug, theme_primary, theme_bg, theme_ink, theme_ink_soft, theme_card, theme_border, theme_tabs, theme_btn2, theme_btn2_ink, theme_btn_border, theme_btn2_border");
    if (STORE_SLUG) q = q.eq("slug", STORE_SLUG);
    q
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("查詢店家失敗", error);
        const row = data?.[0] ?? null;
        setStore(row);
        // 店家自己選的配色。沒設就維持 styles.css 裡的預設
        applyTheme(row && themeFromRow(row));
        setChecking(false);
      });
    return () => { cancelled = true; };
  }, [session]);

  if (!session) return <Login />;

  if (checking) {
    return <div className="center-screen"><p className="sub">載入中…</p></div>;
  }

  if (!store) return <NotAuthorized session={session} />;

  return (
    <AdminShell
      session={session}
      store={store}
      onRename={(name) => setStore((s) => (s ? { ...s, name } : s))}
    />
  );
}

/** 帳號建立了但還沒被加進任何店的名單 */
function NotAuthorized({ session }: { session: Session }) {
  return (
    <div className="center-screen">
      <div className="card">
        <h1>帳號尚未授權</h1>
        <p className="sub">
          你的帳號已經建立，但還沒有被加入任何店家的管理名單，所以看不到資料。
          <br />把下面這組 ID 給系統管理員，請他開通。
        </p>
        <label>登入信箱</label>
        <code className="uid">{session.user.email}</code>
        <label>使用者 ID</label>
        <code className="uid">{session.user.id}</code>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          🚪 登出
        </button>
      </div>
    </div>
  );
}
