import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";

/**
 * 盤點歷史。
 *
 * 只留最新 5 筆（老闆決定的，清理在 submit_stocktake 裡做）。
 * 每一筆都帶著送出當下的完整快照，所以商品之後改名或刪掉，
 * 舊紀錄仍然看得懂——這也是為什麼快照很大：清單先不撈 items 欄位，
 * 點開那一筆才去拿。
 */

interface Row {
  id: string;
  date: string;
  item_count: number;
  total_diff: number;
  created_at: string;
}

/** 快照裡的一列，欄位名由 submit_stocktake 決定 */
interface SnapRow {
  item_id: string;
  item_code: string;
  item_name: string;
  expiry_date: string | null;
  book_qty: number;
  actual_qty: number;
  diff: number;
  is_new: boolean;
  removed: boolean;
}

const diffClass = (v: number) => (v > 0 ? "pos" : v < 0 ? "neg" : "zero");
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export default function InventoryHistory({ store }: { store: Store }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  /** 已經抓過的快照，點回來不用再抓一次 */
  const [snaps, setSnaps] = useState<Record<string, SnapRow[]>>({});
  const [showStock, setShowStock] = useState(false);
  const [loadingSnap, setLoadingSnap] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const { data, error } = await supabase
      .from("inventory_stocktakes")
      .select("id,date,item_count,total_diff,created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    if (error) setErr(error.message);
    else setRows(data as Row[]);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  async function toggle(id: string) {
    setShowStock(false);
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (snaps[id]) return;

    setLoadingSnap(true);
    const { data, error } = await supabase
      .from("inventory_stocktakes").select("items").eq("id", id).maybeSingle();
    if (error) setErr(error.message);
    else if (data) setSnaps((s) => ({ ...s, [id]: (data.items ?? []) as unknown as SnapRow[] }));
    setLoadingSnap(false);
  }

  /** 把同一商品的各批次合成一列總數，就是盤完之後的庫存 */
  function stockOf(snap: SnapRow[]) {
    const m = new Map<string, { code: string; name: string; qty: number }>();
    for (const r of snap) {
      const cur = m.get(r.item_id) ?? { code: r.item_code, name: r.item_name, qty: 0 };
      cur.qty += r.removed ? 0 : (Number(r.actual_qty) || 0);
      m.set(r.item_id, cur);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code, "zh-Hant"));
  }

  return (
    <>
      {err && <div className="msg err">{err}</div>}

      <div className="panel">
        <div className="panel-title">盤點歷史</div>
        <p className="hint" style={{ marginTop: 0 }}>
          只保留最新 5 筆。點一筆可以看那次的異動明細與盤完後的庫存。
        </p>
      </div>

      {rows === null && <div className="panel"><div className="skeleton" style={{ height: "4rem" }} /></div>}

      {rows && rows.length === 0 && (
        <div className="panel empty">
          <div className="emoji">🕘</div>
          <p>還沒有盤點紀錄</p>
        </div>
      )}

      <div className="rows">
        {(rows ?? []).map((r) => {
          const open = openId === r.id;
          const snap = snaps[r.id];
          const changed = (snap ?? []).filter((x) => x.diff !== 0);
          const changedItems = new Set(changed.map((x) => x.item_id)).size;

          return (
            <div className="arow stock" key={r.id}>
              <div
                className="c grow" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                onClick={() => void toggle(r.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void toggle(r.id); } }}
              >
                <b>{r.date}</b>
                <span className="tag2">{r.item_count} 筆批次</span>
                <div className="sub" style={{ marginTop: "0.1875rem" }}>
                  送出時間 {new Date(r.created_at).toLocaleString("zh-TW", { hour12: false })}
                </div>
              </div>

              <div className="c qty">
                <span className={`diff ${diffClass(r.total_diff)}`}>總差異 {signed(r.total_diff)}</span>
                <span className="caret" aria-hidden="true">{open ? "▲" : "▼"}</span>
              </div>

              {open && (
                <div className="expand">
                  {!snap && loadingSnap && <div className="skeleton" style={{ height: "3rem" }} />}

                  {snap && (
                    <>
                      <div className="section-label">本次異動（{changedItems} 項商品）</div>
                      {changed.length === 0
                        ? <p className="hint" style={{ marginTop: 0 }}>這次盤點沒有任何差異。</p>
                        : (
                          <div className="snap">
                            {changed.map((x, i) => (
                              <div className="snap-row" key={`${x.item_id}-${i}`}>
                                <span className="nm">{x.item_code} {x.item_name}</span>
                                <span className="ex">
                                  {x.removed ? "整批移除" : x.is_new ? "新批次" : (x.expiry_date ?? "無效期")}
                                </span>
                                <span className="qt">{x.book_qty} → {x.removed ? 0 : x.actual_qty}</span>
                                <span className={`diff ${diffClass(x.diff)}`}>{signed(x.diff)}</span>
                              </div>
                            ))}
                          </div>
                        )}

                      <button className="slim outline" onClick={() => setShowStock(!showStock)}>
                        {showStock ? "▲ 收合盤點後庫存" : `▼ 顯示盤點後庫存（${stockOf(snap).length} 項）`}
                      </button>

                      {showStock && (
                        <div className="snap" style={{ marginTop: "0.625rem" }}>
                          {stockOf(snap).map((x, i) => (
                            <div className="snap-row" key={`${x.code}-${i}`}>
                              <span className="nm">{x.code} {x.name}</span>
                              <span className={`qt${x.qty === 0 ? " zero" : ""}`}>{x.qty}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
