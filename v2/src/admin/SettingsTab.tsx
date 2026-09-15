import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

/**
 * 設定
 *
 * 放「整家店只有一組、不常改」的東西。第一個進來的是前一天的預約提醒。
 * 營業時間跟營業日留在原本的分頁——那兩個是天天在動的排班，
 * 跟這裡的一次性設定不是同一件事。
 *
 * 只有負責人改得動（RLS 的「owner 改自己的店」政策），
 * 店員看得到現在的設定但存不進去，會拿到下面那句提示。
 */

interface Reminder {
  enabled: boolean;
  /** `HH:MM` */
  time: string;
}

/**
 * 提醒時間的選項：08:00 ~ 22:00 的整點與半點。
 *
 * 只到半小時是因為排程每半小時檢查一次，設 20:15 最快也要等到 20:30
 * 才送得出去，介面上卻顯示 20:15 等於騙人。資料庫的 check 也擋著。
 */
const TIME_CHOICES = (() => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: string[] = [];
  for (let m = 8 * 60; m <= 22 * 60; m += 30) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
})();

export default function SettingsTab({ store }: { store: Store }) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("stores")
      .select("reminder_enabled,reminder_time")
      .eq("id", store.id).single();
    if (error) { setErr(error.message); return; }
    setReminder({
      enabled: data.reminder_enabled,
      time: data.reminder_time.slice(0, 5),   // 資料庫回的是 HH:MM:SS
    });
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  /**
   * 排程每半小時跑一次，靠這兩個欄位決定那一輪要不要送，
   * 所以改完不用重新部署，下一輪就是新設定。
   */
  async function save(next: Reminder) {
    if (busy) return;                                  // 防連點
    setBusy(true); setErr(""); setOk("");

    // ⚠️ 一定要帶 .select()。被 RLS 擋下的 UPDATE **不會回錯誤**——
    //    它是把那一列從可更新範圍濾掉，PostgREST 照樣回 204。
    //    只看 error 的話，店員會看到「已儲存」但其實什麼都沒存。
    const { data, error } = await supabase
      .from("stores")
      .update({ reminder_enabled: next.enabled, reminder_time: next.time })
      .eq("id", store.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功：只有負責人可以修改設定，請聯絡負責人。");
    } else {
      setReminder(next);
      setOk(next.enabled ? `提醒時間已設為 ${next.time}` : "已關閉前一天的提醒");
    }
    setBusy(false);
  }

  return (
    <div className="cols">
      <div>
        <div className="panel">
          <div className="panel-title">預約提醒</div>
          <p className="sub" style={{ marginBottom: 16 }}>
            預約的<b>前一天</b>自動用 LINE 提醒客人，每筆預約只會發一次。
            <br />沒有綁定 LINE 的預約不會發送。
          </p>

          {reminder === null
            ? <div className="skeleton" style={{ height: "3.75rem" }} />
            : (
              <>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={reminder.enabled}
                    disabled={busy}
                    onChange={(e) => void save({ ...reminder, enabled: e.target.checked })}
                  />
                  開啟前一天的提醒
                </label>

                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="rtime">發送時間</label>
                  <select
                    id="rtime"
                    value={reminder.time}
                    disabled={busy || !reminder.enabled}
                    onChange={(e) => void save({ ...reminder, time: e.target.value })}
                  >
                    {TIME_CHOICES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <p className="hint">
                    只能設整點或半點——排程每半小時檢查一次，設 20:15 也要等到 20:30 才送得出去。
                  </p>
                </div>
              </>
            )}
        </div>

        {err && <div className="msg err">{err}</div>}
        {ok && <div className="msg ok">{ok}</div>}
      </div>
    </div>
  );
}
