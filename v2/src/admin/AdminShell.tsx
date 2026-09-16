import { lazy, Suspense, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import BookingsTab from "./BookingsTab";
import MembersTab from "./MembersTab";
import OperatingDaysTab from "./OperatingDaysTab";
import AdminsTab from "./AdminsTab";
import SettingsTab from "./SettingsTab";

// 報表帶著圖表套件，體積比其他分頁加起來還大，點進去才下載
const ReportsTab = lazy(() => import("./ReportsTab"));

export interface Store {
  id: string;
  name: string;
  slug: string;
  /** 後台主色 `#rrggbb`；null 用預設 */
  theme_primary: string | null;
  /** 後台底色 `#rrggbb`；null 用預設 */
  theme_bg: string | null;
}

type TabKey = "bookings" | "members" | "days" | "reports" | "settings" | "admins";

export default function AdminShell({ session, store }: { session: Session; store: Store }) {
  const [tab, setTab] = useState<TabKey>("bookings");
  const [role, setRole] = useState<string | null>(null);
  /** 手機版的漢堡選單開著沒。桌面版不會用到這個狀態 */
  const [menuOpen, setMenuOpen] = useState(false);

  // 自己在這家店是什麼身分。權限管理只有負責人看得到——
  // 藏起來只是介面上的事，真正的把關在資料庫函式裡（0007_admin_management.sql）。
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("store_admins")
      .select("role")
      .eq("store_id", store.id)
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setRole(data?.role ?? null); });
    return () => { cancelled = true; };
  }, [store.id, session.user.id]);

  const isOwner = role === "owner";

  const tabs: { key: TabKey; label: string }[] = [
    { key: "bookings", label: "📋 預約管理" },
    { key: "members", label: "👥 會員清單" },
    { key: "days", label: "📅 營業日設定" },
    { key: "reports", label: "📊 報表" },
    { key: "settings", label: "⚙️ 設定" },
    ...(isOwner ? [{ key: "admins" as TabKey, label: "🔑 權限管理" }] : []),
  ];

  return (
    <div className="wrap wide">
      <div className="topbar">
        <div>
          <h1>{store.name}</h1>
          <div className="who">
            {session.user.email}
            {role && <span className="tag2">{role === "owner" ? "負責人" : "店員"}</span>}
          </div>
        </div>
        <button className="slim ghost" onClick={() => supabase.auth.signOut()}>
          🚪 登出
        </button>
      </div>

      {/*
        * 分頁有六個，在手機上一排排不下（會擠成兩行還會斷字），
        * 所以窄螢幕改成漢堡選單、寬螢幕維持一整排。
        * 兩份 markup 都在，由 CSS 決定顯示哪一份——用 JS 判斷視窗寬度的話，
        * 轉螢幕方向不會跟著變，而且第一次畫面會閃一下。
        */}
      <div className="tabs admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="navbar">
        <button
          className="outline"
          aria-expanded={menuOpen}
          aria-label="切換分頁選單"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="burger" aria-hidden="true">☰</span>
          {tabs.find((t) => t.key === tab)?.label}
        </button>

        {menuOpen && (
          <div className="menu">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => { setTab(t.key); setMenuOpen(false); }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "bookings" && <BookingsTab store={store} />}
      {tab === "members" && <MembersTab store={store} />}
      {tab === "days" && <OperatingDaysTab store={store} />}
      {tab === "reports" && (
        <Suspense fallback={<div className="skeleton" style={{ height: "8rem" }} />}>
          <ReportsTab store={store} />
        </Suspense>
      )}
      {tab === "settings" && <SettingsTab store={store} />}
      {tab === "admins" && isOwner && <AdminsTab store={store} myUserId={session.user.id} />}
    </div>
  );
}
