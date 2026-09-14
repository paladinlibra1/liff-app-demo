import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import BookingsTab from "./BookingsTab";
import MembersTab from "./MembersTab";
import OperatingDaysTab from "./OperatingDaysTab";

export interface Store {
  id: string;
  name: string;
  slug: string;
}

const TABS = [
  { key: "bookings", label: "預約管理" },
  { key: "members", label: "會員清單" },
  { key: "days", label: "營業日設定" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function AdminShell({ session, store }: { session: Session; store: Store }) {
  const [tab, setTab] = useState<TabKey>("bookings");

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>{store.name}</h1>
          <div className="who">{session.user.email}</div>
        </div>
        <button className="slim ghost" onClick={() => supabase.auth.signOut()}>
          登出
        </button>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
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
    </div>
  );
}
