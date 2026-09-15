import { useEffect, useState } from "react";
import { fetchStore, fetchMe, type StoreInfo, type MyProfile } from "./api";
import { initLiff, type LiffState } from "./liff";
import RegisterForm from "./RegisterForm";
import { BOOKING_URL } from "./links";

/**
 * 獨立的會員綁定頁（`/register`）
 *
 * 給圖文選單放「會員綁定」用。它跟「我的預約」共用同一個 LIFF 應用程式：
 * LIFF 允許在網址後面接路徑，`https://liff.line.me/<我的預約的 LIFF ID>/register`
 * 就會開到這一頁，而且 init 用的還是同一個 ID，所以不必為它另外申請一個 LIFF。
 *
 * 已經綁過的人進來不會看到表單，直接告訴他綁好了、給一顆去預約的按鈕。
 */
export default function RegisterApp() {
  const [liffState, setLiffState] = useState<LiffState | null>(null);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [member, setMember] = useState<MyProfile | null>(null);
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchStore().then((s) => !cancelled && setStore(s)).catch(() => { /* 店名拿不到不影響綁定 */ });

    initLiff("my").then(async (state) => {
      if (cancelled) return;
      setLiffState(state);
      if (state.kind !== "ready") { setChecked(true); return; }
      try {
        const me = await fetchMe(state.viewer.accessToken);
        if (!cancelled) setMember(me.member);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setChecked(true);
      }
    });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="wrap narrow">
      <div className="brand">
        <div className="name">{store?.name ?? "　"}</div>
        <div className="tag">會員綁定</div>
      </div>

      {liffState?.kind === "error" && (
        <div className="msg err">{liffState.message}</div>
      )}
      {liffState?.kind === "preview" && (
        <div className="msg note">預覽模式：{liffState.reason}</div>
      )}
      {err && <div className="msg err">{err}</div>}

      {!checked && <div className="panel"><div className="skeleton" style={{ height: "9rem" }} /></div>}

      {checked && liffState?.kind === "ready" && !member && (
        <RegisterForm
          accessToken={liffState.viewer.accessToken}
          onDone={setMember}
        />
      )}

      {checked && member && (
        <div className="panel">
          <div className="done">
            <div className="mark">✓</div>
            <p className="sub" style={{ marginBottom: 0 }}>
              <b>{member.name}</b> 您好，會員已經綁定完成。
            </p>
          </div>
          <button onClick={() => { window.location.href = BOOKING_URL; }}>
            📅 馬上預約
          </button>
        </div>
      )}
    </div>
  );
}
