import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import { apiUrl } from "../lib/storePath";

/**
 * 😴 沉睡客／🆕 從未預約名單，以及發關懷 LINE。
 *
 * 名單本身是算出來的，資料庫只存「人為」的兩件事：發過訊息的時間、
 * 以及被排除的人。所以這裡讀 `member_followups`，不是讀一份名單。
 *
 * 發送走 `/api/admin/followups/send`（Worker），不是直接打 LINE——
 * 推播 token 只存在 Worker，而且那支路徑會自己再驗一次身分與店別。
 */

/** 發過訊息之後幾天內不再出現在名單上，免得同一位客人被連續轟炸 */
const COOLDOWN_DAYS = 30;

export interface Person {
  /** 會員 id。認不到會員的（只有電話的舊資料）就是 null，發不了訊息 */
  memberId: string | null;
  name: string;
  phone: string;
  lineUserId: string | null;
  /** 名單上那一行的補充說明 */
  detail: string;
}

interface FollowUp {
  member_id: string;
  last_sent_at: string | null;
  sent_count: number;
  excluded: boolean;
}

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export default function FollowUpLists({
  store, dormant, never,
}: {
  store: Store;
  dormant: Person[];
  never: Person[];
}) {
  const [list, setList] = useState<"dormant" | "never">("dormant");
  /** 沒綁 LINE 的人發不了訊息，預設收起來，但要留一個看得見的入口 */
  const [showNoLine, setShowNoLine] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [followUps, setFollowUps] = useState<Record<string, FollowUp>>({});
  const [template, setTemplate] = useState("");
  const [savedTemplate, setSavedTemplate] = useState("");

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, s] = await Promise.all([
      supabase.from("member_followups")
        .select("member_id,last_sent_at,sent_count,excluded").eq("store_id", store.id),
      supabase.from("stores").select("dormant_message").eq("id", store.id).maybeSingle(),
    ]);
    if (f.error) { setErr(f.error.message); return; }
    if (s.error) { setErr(s.error.message); return; }
    setFollowUps(Object.fromEntries((f.data as FollowUp[]).map((x) => [x.member_id, x])));
    const t = s.data?.dormant_message ?? "";
    setTemplate(t);
    setSavedTemplate(t);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  const source = list === "dormant" ? dormant : never;

  const { shown, hiddenByCooldown, noLineCount } = useMemo(() => {
    let hiddenByCooldown = 0;
    const kept = source.filter((p) => {
      const f = p.memberId ? followUps[p.memberId] : undefined;
      if (f?.excluded) return false;                        // 排除的人不再出現
      if (f?.last_sent_at && daysSince(f.last_sent_at) < COOLDOWN_DAYS) {
        hiddenByCooldown++;                                 // 冷卻期內先不顯示
        return false;
      }
      return true;
    });
    const noLineCount = kept.filter((p) => !p.lineUserId).length;
    return {
      shown: showNoLine ? kept : kept.filter((p) => p.lineUserId),
      hiddenByCooldown, noLineCount,
    };
  }, [source, followUps, showNoLine]);

  /** 可以發訊息的：有會員身分、有綁 LINE */
  const sendable = shown.filter((p) => p.memberId && p.lineUserId);
  const pickedHere = sendable.filter((p) => picked.has(p.memberId!));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
    setOk("");
  }

  function switchList(v: "dormant" | "never") {
    setList(v);
    setPicked(new Set());        // 換名單不留著上一份的勾選，免得誤發
    setOk(""); setErr("");
  }

  async function saveTemplate() {
    if (busy) return;                                       // 防連點
    setBusy(true); setErr(""); setOk("");
    const { data, error } = await supabase.from("stores")
      .update({ dormant_message: template }).eq("id", store.id).select("id");
    if (error) setErr(error.message);
    else if (!data?.length) setErr("沒有儲存成功，請確認你的帳號權限。");
    else { setSavedTemplate(template); setOk("已儲存訊息範本"); }
    setBusy(false);
  }

  /** 發送。等它送完才回應，店家要當場知道誰成功誰失敗 */
  async function send() {
    if (busy || pickedHere.length === 0) return;            // 防連點
    if (template !== savedTemplate) {
      return setErr("訊息範本改過還沒儲存，請先按「儲存範本」再發送。");
    }
    if (!confirm(
      `確定要發送關懷訊息給 ${pickedHere.length} 位客人嗎？\n\n` +
      `訊息會立刻送到他們的 LINE，送出去就收不回來了。`,
    )) return;

    setBusy(true); setErr(""); setOk("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) { setErr("登入已過期，請重新登入後台"); setBusy(false); return; }

      const res = await fetch(apiUrl("/api/admin/followups/send"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ member_ids: pickedHere.map((p) => p.memberId) }),
      });
      const body = await res.json() as {
        sent?: number; failed?: { name: string; reason: string }[]; error?: string;
      };
      if (!res.ok) { setErr(body.error ?? "發送失敗"); setBusy(false); return; }

      const failed = body.failed ?? [];
      setOk(
        `已發送 ${body.sent ?? 0} 位` +
        (failed.length ? `，${failed.length} 位沒送出：` +
          failed.map((f) => `${f.name}（${f.reason}）`).join("、") : ""),
      );
      setPicked(new Set());
      await load();                                         // 冷卻期要立刻反映
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div className="panel">
      <div className="seg" style={{ marginBottom: "0.875rem" }}>
        <button type="button" aria-pressed={list === "dormant"} onClick={() => switchList("dormant")}>
          😴 沉睡客
        </button>
        <button type="button" aria-pressed={list === "never"} onClick={() => switchList("never")}>
          🆕 從未預約
        </button>
      </div>

      <div className="panel-title" style={{ margin: 0 }}>
        {list === "dormant"
          ? "😴 沉睡客名單（最近一次到店超過 90 天）"
          : "🆕 已加會員但從未預約（只列身分為客人）"}
      </div>
      <p className="hint">
        共 {shown.length} 位
        {hiddenByCooldown > 0 && `　·　🔕 ${hiddenByCooldown} 位在 ${COOLDOWN_DAYS} 天內發過，暫時隱藏`}
        {noLineCount > 0 && (
          <>
            {"　·　"}💬 {noLineCount} 位沒綁 LINE
            <button className="linkish" onClick={() => setShowNoLine(!showNoLine)}>
              {showNoLine ? "隱藏" : "顯示"}
            </button>
          </>
        )}
      </p>

      <div className="field" style={{ marginTop: "0.875rem" }}>
        <label>💬 LINE 訊息範本</label>
        <textarea
          rows={4} value={template}
          onChange={(e) => { setTemplate(e.target.value); setOk(""); }}
        />
        <p className="hint">
          <code>{"{{name}}"}</code> 會換成客人的姓名。同一份範本會發給你勾選的每一位。
        </p>
        <button className="slim" disabled={busy || template === savedTemplate} onClick={saveTemplate}>
          💾 儲存範本
        </button>
      </div>

      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}

      {shown.length === 0 ? (
        <p className="hint">
          {list === "dormant" ? "目前沒有沉睡客。" : "沒有從未預約的會員。"}
          {hiddenByCooldown > 0 && `（有 ${hiddenByCooldown} 位在冷卻期內）`}
        </p>
      ) : (
        <>
          <div className="bk-acts" style={{ marginTop: "0.875rem" }}>
            <button
              className="slim outline"
              onClick={() => setPicked(new Set(
                pickedHere.length === sendable.length ? [] : sendable.map((p) => p.memberId!),
              ))}
            >
              {pickedHere.length === sendable.length && sendable.length > 0 ? "◻️ 取消全選" : "✅ 全選"}
            </button>
            <button className="slim" disabled={busy || pickedHere.length === 0} onClick={send}>
              {busy ? "⏳ 發送中…" : `💬 發送給 ${pickedHere.length} 位`}
            </button>
          </div>

          <div className="rows" style={{ marginTop: "0.625rem" }}>
            {shown.map((p) => {
              const f = p.memberId ? followUps[p.memberId] : undefined;
              const canSend = Boolean(p.memberId && p.lineUserId);
              return (
                <div className="arow stock" key={p.memberId ?? p.phone}>
                  <div className="c grow">
                    <label className="pick">
                      <input
                        type="checkbox" disabled={!canSend}
                        checked={Boolean(p.memberId && picked.has(p.memberId))}
                        onChange={() => p.memberId && toggle(p.memberId)}
                      />
                      <span>
                        <b>{p.name || "（沒有姓名）"}</b>
                        {canSend
                          ? <span className="tag2 line">LINE</span>
                          : <span className="badge old">沒綁 LINE</span>}
                        <span className="sub" style={{ display: "block", marginTop: "0.1875rem" }}>
                          {p.detail}
                          {p.phone && ` · ${p.phone}`}
                          {f?.sent_count ? ` · 已發過 ${f.sent_count} 次` : ""}
                        </span>
                      </span>
                    </label>
                  </div>

                  {p.memberId && (
                    <div className="c acts">
                      <button
                        className="slim outline" disabled={busy}
                        onClick={() => void exclude(p)}
                      >
                        🚫 不再提醒
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  /** 把這個人從名單上永久拿掉（搬家了、或明講不想被打擾） */
  async function exclude(p: Person) {
    if (busy || !p.memberId) return;                        // 防連點
    if (!confirm(`確定不要再提醒「${p.name}」嗎？\n\n之後這位客人不會再出現在名單上。`)) return;

    setBusy(true); setErr(""); setOk("");
    const { data, error } = await supabase.from("member_followups")
      .upsert({ member_id: p.memberId, store_id: store.id, excluded: true })
      .select("member_id");
    if (error) setErr(error.message);
    else if (!data?.length) setErr("沒有儲存成功，請確認你的帳號權限。");
    else { setOk(`已將「${p.name}」從名單移除`); await load(); }
    setBusy(false);
  }
}
