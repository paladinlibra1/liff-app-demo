import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import {
  applyTheme, contrastWithWhite, DEFAULT_THEME, HEX, PRESETS, type Theme,
} from "./theme";

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

  /*
   * 配色。
   *
   * 改動當場就套到整個畫面（applyTheme），不用等存檔——顏色這種東西
   * 要看到才知道對不對，存了再看等於每次都要多按一次。
   * 沒存就離開分頁的話，下次載入還是資料庫裡那組。
   */
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [savedTheme, setSavedTheme] = useState<Theme>(DEFAULT_THEME);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("stores")
      .select("reminder_enabled,reminder_time,theme_primary,theme_bg")
      .eq("id", store.id).single();
    if (error) { setErr(error.message); return; }
    setReminder({
      enabled: data.reminder_enabled,
      time: data.reminder_time.slice(0, 5),   // 資料庫回的是 HH:MM:SS
    });
    const t: Theme = {
      primary: data.theme_primary ?? DEFAULT_THEME.primary,
      bg: data.theme_bg ?? DEFAULT_THEME.bg,
    };
    setTheme(t);
    setSavedTheme(t);
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

  /** 改一個顏色：畫面立刻跟著變，存檔是另一個動作 */
  function preview(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function saveTheme() {
    if (busy) return;                                  // 防連點
    if (!HEX.test(theme.primary) || !HEX.test(theme.bg)) {
      setErr("顏色格式要是 #RRGGBB");
      return;
    }
    setBusy(true); setErr(""); setOk("");

    // 跟提醒設定一樣要帶 .select()：被 RLS 擋下的 UPDATE 不會回錯誤
    const { data, error } = await supabase
      .from("stores")
      .update({ theme_primary: theme.primary, theme_bg: theme.bg })
      .eq("id", store.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功：只有負責人可以修改設定，請聯絡負責人。");
    } else {
      setSavedTheme(theme);
      setOk("配色已儲存，其他店員重新整理後也會看到");
    }
    setBusy(false);
  }

  /** 還原成上次存檔的那組（不是預設值——那是另一顆） */
  function revert() {
    setTheme(savedTheme);
    applyTheme(savedTheme);
    setOk(""); setErr("");
  }

  const dirty = theme.primary !== savedTheme.primary || theme.bg !== savedTheme.bg;
  const contrast = contrastWithWhite(theme.primary);

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

        {/* ───────── 配色 ───────── */}
        <div className="panel">
          <div className="panel-title">後台配色</div>
          <p className="sub" style={{ marginBottom: 16 }}>
            只影響後台。客人在 LINE 裡看到的預約頁維持原本的品牌色。
            <br />改了會立刻套用到畫面上，按儲存才會留下來。
          </p>

          <div className="filters">
            <div className="f">
              <label htmlFor="c-primary">主色（按鈕、強調）</label>
              <div className="color-row">
                <input
                  id="c-primary" type="color" value={theme.primary}
                  onChange={(e) => preview({ ...theme, primary: e.target.value })}
                />
                <input
                  value={theme.primary} spellCheck={false}
                  onChange={(e) => preview({ ...theme, primary: e.target.value })}
                />
              </div>
            </div>

            <div className="f">
              <label htmlFor="c-bg">頁面底色</label>
              <div className="color-row">
                <input
                  id="c-bg" type="color" value={theme.bg}
                  onChange={(e) => preview({ ...theme, bg: e.target.value })}
                />
                <input
                  value={theme.bg} spellCheck={false}
                  onChange={(e) => preview({ ...theme, bg: e.target.value })}
                />
              </div>
            </div>
          </div>

          {/*
            * 按鈕是白字。對比低於 4.5 的顏色，字會糊在底色裡。
            * 只提醒不擋——顏色是店家的選擇，我們只負責講清楚。
            */}
          {contrast < 4.5 && (
            <div className="msg note">
              ⚠️ 這個主色配白字的對比只有 {contrast.toFixed(1)}:1，按鈕上的字會不好讀。
              建議選深一點的顏色（4.5 以上）。
            </div>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label>快速選擇</label>
            <div className="swatches">
              {PRESETS.map((p) => (
                <button
                  key={p.name} type="button" className="swatch"
                  aria-pressed={theme.primary === p.theme.primary && theme.bg === p.theme.bg}
                  onClick={() => preview(p.theme)}
                >
                  <span className="dot" style={{ background: p.theme.primary }} />
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bk-acts">
            <button className="slim" disabled={busy || !dirty} onClick={saveTheme}>
              {busy ? "⏳ 儲存中…" : "💾 儲存配色"}
            </button>
            <button className="slim ghost" disabled={!dirty} onClick={revert}>
              ↩️ 還原
            </button>
          </div>
        </div>

        {err && <div className="msg err">{err}</div>}
        {ok && <div className="msg ok">{ok}</div>}
      </div>
    </div>
  );
}
