import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import BookingsTab from "./BookingsTab";
import MembersTab from "./MembersTab";
import OperatingDaysTab from "./OperatingDaysTab";
import AdminsTab from "./AdminsTab";

export interface Store {
  id: string;
  name: string;
  slug: string;
}

type TabKey = "bookings" | "members" | "days" | "admins";

export default function AdminShell({ session, store }: { session: Session; store: Store }) {
  const [tab, setTab] = useState<TabKey>("bookings");
  const [role, setRole] = useState<string | null>(null);

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
    { key: "bookings", label: "預約管理" },
    { key: "members", label: "會員清單" },
    { key: "days", label: "營業日設定" },
    ...(isOwner ? [{ key: "admins" as TabKey, label: "權限管理" }] : []),
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
          登出
        </button>
      </div>

      <div className="tabs">
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

      {tab === "bookings" && <BookingsTab store={store} />}
      {tab === "members" && <MembersTab store={store} />}
      {tab === "days" && <OperatingDaysTab store={store} />}
      {tab === "admins" && isOwner && <AdminsTab store={store} myUserId={session.user.id} />}
    </div>
  );
}
