import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import {
  applyTheme, contrast, contrastWithWhite, DEFAULT_THEME, FOLLOWS, HEX, PRESETS,
  themeFromRow, themeToRow, type Theme, type ThemeKey,
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
/** 設定分頁上的顏色欄位，依畫面區塊分組 */
const COLOR_GROUPS: { title: string; fields: { key: ThemeKey; label: string }[] }[] = [
  {
    title: "主色與底色",
    fields: [
      { key: "primary", label: "主色（按鈕、選取）" },
      { key: "bg", label: "頁面底色" },
    ],
  },
  {
    title: "文字",
    fields: [
      { key: "ink", label: "主要文字（含時間、電話、標題）" },
      { key: "inkSoft", label: "次要文字（說明、標籤）" },
    ],
  },
  {
    title: "卡片與邊框",
    fields: [
      { key: "card", label: "卡片底色" },
      { key: "border", label: "邊框" },
    ],
  },
  {
    title: "按鈕",
    fields: [
      { key: "btnBorder", label: "主要按鈕邊框" },
      { key: "btn2", label: "次要按鈕底色（編輯、今天…）" },
      { key: "btn2Ink", label: "次要按鈕文字" },
      { key: "btn2Border", label: "次要按鈕邊框" },
    ],
  },
  {
    title: "分頁列",
    fields: [
      { key: "tabs", label: "分頁列底色" },
    ],
  },
];

const THEME_KEYS = Object.keys(DEFAULT_THEME) as ThemeKey[];

const TIME_CHOICES = (() => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: string[] = [];
  for (let m = 8 * 60; m <= 22 * 60; m += 30) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
})();

export default function SettingsTab({ store, onRename }: {
  store: Store;
  /** 改完店名要讓上面的標題跟著換，不然得重新整理才看得到 */
  onRename?: (name: string) => void;
}) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  /** 店名。輸入框自己一份，按了儲存才寫回資料庫 */
  const [name, setName] = useState(store.name);

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
      // 要寫成一整串字面值，supabase-js 才推得出回傳型別
      .select("name,reminder_enabled,reminder_time,theme_primary,theme_bg,theme_ink,theme_ink_soft,theme_card,theme_border,theme_tabs,theme_btn2,theme_btn2_ink,theme_btn_border,theme_btn2_border")
      .eq("id", store.id).single();
    if (error) { setErr(error.message); return; }
    setName(data.name);
    setReminder({
      enabled: data.reminder_enabled,
      time: data.reminder_time.slice(0, 5),   // 資料庫回的是 HH:MM:SS
    });
    const t = themeFromRow(data);
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

  /**
   * 改店名。
   *
   * 店名不只是標題：LINE 通知的卡片標題、群組通知都是即時讀資料庫，
   * 所以存完就會跟著換，不用重新部署。
   * 網頁分頁的標題（index.html 的 <title>）是寫死的，那個不會跟著改。
   */
  async function saveName() {
    if (busy) return;                                  // 防連點
    const next = name.trim();
    if (!next) { setErr("店名不能空白"); return; }
    if (next === store.name) return;

    setBusy(true); setErr(""); setOk("");

    // 跟其他設定一樣要帶 .select()：被 RLS 擋下的 UPDATE 不會回錯誤
    const { data, error } = await supabase
      .from("stores").update({ name: next }).eq("id", store.id).select("id");

    if (error) {
      setErr(error.message);
    } else if (!data || data.length === 0) {
      setErr("沒有儲存成功：只有負責人可以修改店名，請聯絡負責人。");
    } else {
      onRename?.(next);
      setOk(`店名已改成「${next}」，其他店員重新整理後也會看到`);
    }
    setBusy(false);
  }

  /**
   * 改單一個顏色。
   * 邊框原本跟按鈕底色一樣（＝沒框）的話，改底色時邊框一起換，
   * 不然換了主色會留下一圈舊顏色。
   */
  function change(key: ThemeKey, value: string) {
    const next = { ...theme, [key]: value };
    for (const [k, base] of Object.entries(FOLLOWS) as [ThemeKey, ThemeKey][]) {
      if (base === key && theme[k].toLowerCase() === theme[base].toLowerCase()) next[k] = value;
    }
    preview(next);
  }

  /** 改一個顏色：畫面立刻跟著變，存檔是另一個動作 */
  function preview(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  async function saveTheme() {
    if (busy) return;                                  // 防連點
    if (THEME_KEYS.some((k) => !HEX.test(theme[k]))) {
      setErr("顏色格式要是 #RRGGBB");
      return;
    }
    setBusy(true); setErr(""); setOk("");

    // 跟提醒設定一樣要帶 .select()：被 RLS 擋下的 UPDATE 不會回錯誤
    const { data, error } = await supabase
      .from("stores")
      .update(themeToRow(theme))
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

  const dirty = THEME_KEYS.some((k) => theme[k] !== savedTheme[k]);

  /*
   * 看不清楚的組合只提醒不擋——顏色是店家的選擇，我們只負責講清楚。
   * 4.5 是 WCAG 對一般文字的門檻。
   */
  const warnings = [
    { pair: "主色配按鈕上的白字", ratio: contrastWithWhite(theme.primary) },
    { pair: "主要文字配卡片底色", ratio: contrast(theme.ink, theme.card) },
    { pair: "次要文字配卡片底色", ratio: contrast(theme.inkSoft, theme.card) },
    { pair: "次要按鈕的字配按鈕底色", ratio: contrast(theme.btn2Ink, theme.btn2) },
  ].filter((w) => w.ratio < 4.5);

  return (
    <>
      {/* 訊息放最上面：兩欄並排時，存左邊的東西不該跑到右下角才有回應 */}
      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}

      <div className="cols">
        <div>
          <div className="panel">
            <div className="panel-title">店名</div>
            <p className="sub" style={{ marginBottom: 16 }}>
              後台標題、客人收到的 LINE 通知都會用這個名字。
            </p>
            <div className="field">
              <label htmlFor="sname">店名</label>
              <input
                id="sname" value={name} maxLength={40} disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="chips">
              <button className="slim" disabled={busy || !name.trim() || name.trim() === store.name}
                onClick={saveName}>
                💾 儲存店名
              </button>
              {name !== store.name && (
                <button className="slim ghost" disabled={busy} onClick={() => setName(store.name)}>
                  ↩️ 取消修改
                </button>
              )}
            </div>
          </div>

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
        </div>

        {/*
          * 配色放右邊寬欄。原本跟預約提醒擠在同一欄，
          * 電腦上只用了左邊 25rem，九個顏色一路往下排得很長。
          */}
        <div>
          <div className="panel">
            <div className="panel-title">後台配色</div>
            <p className="sub" style={{ marginBottom: 16 }}>
              只影響後台。客人在 LINE 裡看到的預約頁維持原本的品牌色。
              <br />改了會立刻套用到畫面上，按儲存才會留下來。
            </p>

            <div className="cgroups">
              {COLOR_GROUPS.map((g) => (
                <div className="cgroup" key={g.title}>
                  <label style={{ fontWeight: 650 }}>{g.title}</label>
                  <div className="filters">
                    {g.fields.map((f) => (
                      <div className="f" key={f.key}>
                        <label htmlFor={`c-${f.key}`}>{f.label}</label>
                        <div className="color-row">
                          <input
                            id={`c-${f.key}`} type="color" value={theme[f.key]}
                            onChange={(e) => change(f.key, e.target.value)}
                          />
                          <input
                            value={theme[f.key]} spellCheck={false} aria-label={`${f.label}色碼`}
                            onChange={(e) => change(f.key, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {warnings.length > 0 && (
              <div className="msg note">
                ⚠️ 下面這些組合的對比不夠，字會不好讀（建議 4.5 以上）：
                {warnings.map((w) => (
                  <div key={w.pair}>・{w.pair}：{w.ratio.toFixed(1)}:1</div>
                ))}
              </div>
            )}

            <div className="field" style={{ marginTop: 16 }}>
              <label>快速選擇</label>
              <div className="swatches">
                {PRESETS.map((p) => (
                  <button
                    key={p.name} type="button" className="swatch"
                    aria-pressed={THEME_KEYS.every((k) => theme[k] === p.theme[k])}
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
              <button className="slim ghost" disabled={busy || !dirty} onClick={revert}>
                ↩️ 還原
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
