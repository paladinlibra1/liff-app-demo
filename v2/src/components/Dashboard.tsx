import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Store = { id: string; name: string; slug: string };

export default function Dashboard({ session, store }: { session: Session; store: Store }) {
  const [counts, setCounts] = useState<{ members: number; upcoming: number; days: number } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);

    // head:true + count 只取筆數，不把資料撈回來
    Promise.all([
      supabase.from("members").select("*", { count: "exact", head: true }),
      supabase.from("bookings").select("*", { count: "exact", head: true })
        .eq("status", "active").gte("date", today),
      supabase.from("operating_days").select("*", { count: "exact", head: true })
        .eq("is_operating", true).gte("date", today),
    ])
      .then(([m, b, d]) => {
        const bad = [m, b, d].find((r) => r.error);
        if (bad?.error) throw bad.error;
        setCounts({ members: m.count ?? 0, upcoming: b.count ?? 0, days: d.count ?? 0 });
      })
      .catch((e) => setErr(e.message ?? String(e)));
  }, [store.id]);

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

      {err && <div className="msg err">讀取失敗：{err}</div>}

      <div className="stat-row">
        <div className="stat">
          <div className="n">{counts ? counts.members : "—"}</div>
          <div className="k">會員人數</div>
        </div>
        <div className="stat">
          <div className="n">{counts ? counts.upcoming : "—"}</div>
          <div className="k">今天起的預約</div>
        </div>
        <div className="stat">
          <div className="n">{counts ? counts.days : "—"}</div>
          <div className="k">今天起的營業日</div>
        </div>
      </div>

      <h2>接下來要做的</h2>
      <p className="sub">
        目前只有骨架與登入。預約管理、會員清單、營業日設定會陸續接上來。
        <br />資料全部經過 RLS：你只看得到自己有權限的店。
      </p>
    </div>
  );
}
