import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import SortableRows from "./SortableRows";
import { UNCATEGORIZED, itemComparator, seriesNames, type Item, type Series } from "./inventory";

/**
 * 系列與排序（舊系統商品管理裡的「🏷️ 系列與排序」模式）。
 *
 * 系列可以新增、改名、刪除、拖曳調順序；商品只能在自己的系列裡上下移動——
 * 要換系列是在商品的編輯表單裡改分類，不是靠拖的。
 */
export default function InventorySeries({
  store, type, series, items, reload,
}: {
  store: Store;
  type: string;
  series: Series[];
  items: Item[];
  reload: () => Promise<void>;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  /** 正在改名的系列 id 與新名字 */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const mine = useMemo(
    () => series.filter((s) => s.type === type).sort((a, b) => a.sort_order - b.sort_order),
    [series, type],
  );
  const order = useMemo(() => seriesNames(series, type), [series, type]);
  const ofType = useMemo(
    () => items.filter((it) => it.type === type).sort(itemComparator(order)),
    [items, type, order],
  );

  const countOf = (name: string) =>
    ofType.filter((it) => (it.category ?? UNCATEGORIZED) === name).length;

  /**
   * 所有寫入都走這裡：鎖住畫面防連點，錯誤統一顯示，最後一定重讀。
   * 失敗也要重讀——拖曳是先照新順序畫再寫入的，不重讀的話畫面會停在
   * 一個其實沒存進去的順序上。
   */
  async function run(fn: () => Promise<string | null>) {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const msg = await fn();
      if (msg) setErr(msg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    await reload();
    setBusy(false);
  }

  function addSeries() {
    const name = adding.trim();
    if (!name) return;
    if (name === UNCATEGORIZED) return setErr(`「${UNCATEGORIZED}」是畫面上的保留字，不能當系列名稱`);
    if (order.includes(name)) return setErr("這個系列已經存在");

    void run(async () => {
      const max = mine.reduce((m, s) => Math.max(m, s.sort_order), -1);
      const { data, error } = await supabase.from("inventory_series")
        .insert({ store_id: store.id, type, name, sort_order: max + 1 })
        .select("id");
      if (error) return error.message;
      if (!data?.length) return "沒有新增成功，請確認你的帳號權限。";
      setAdding("");
      return null;
    });
  }

  function saveRename(s: Series) {
    const name = (renaming?.name ?? "").trim();
    if (!name || name === s.name) { setRenaming(null); return; }
    if (name === UNCATEGORIZED) return setErr(`「${UNCATEGORIZED}」是畫面上的保留字，不能當系列名稱`);
    if (order.includes(name)) return setErr("這個系列已經存在");

    void run(async () => {
      const { data, error } = await supabase.from("inventory_series")
        .update({ name }).eq("id", s.id).select("id");
      if (error) return error.message;
      if (!data?.length) return "沒有改名成功，請確認你的帳號權限。";

      // 商品的 category 存的是系列名稱（不是 FK），改名要一起帶著走，
      // 不然底下的商品會全部掉到「未分類」。
      const { error: e2 } = await supabase.from("inventory_items")
        .update({ category: name })
        .eq("store_id", store.id).eq("type", type).eq("category", s.name);
      if (e2) return `系列改名了，但商品的分類沒更新：${e2.message}`;

      setRenaming(null);
      return null;
    });
  }

  function deleteSeries(s: Series) {
    const used = countOf(s.name);
    if (used) {
      return setErr(`系列「${s.name}」底下還有 ${used} 項商品，請先把商品改到別的系列，才能刪除。`);
    }
    if (!confirm(`確定要刪除系列「${s.name}」嗎？`)) return;

    void run(async () => {
      const { data, error } = await supabase.from("inventory_series")
        .delete().eq("id", s.id).select("id");
      if (error) return error.message;
      if (!data?.length) return "沒有刪除成功，請確認你的帳號權限。";
      return null;
    });
  }

  /** 拖完重新編號 0…n-1，順序才不會留下空隙或重複 */
  function reorderSeries(ordered: Series[]) {
    return run(async () => {
      const rows = ordered.map((s, i) => ({
        id: s.id, store_id: store.id, type: s.type, name: s.name, sort_order: i,
      }));
      const { data, error } = await supabase.from("inventory_series").upsert(rows).select("id");
      if (error) return error.message;
      if (!data?.length) return "沒有儲存順序，請確認你的帳號權限。";
      return null;
    });
  }

  function reorderItems(ordered: Item[]) {
    return run(async () => {
      const rows = ordered.map((it, i) => ({
        id: it.id, store_id: store.id, name: it.name, type: it.type, sort_order: i,
      }));
      const { data, error } = await supabase.from("inventory_items").upsert(rows).select("id");
      if (error) return error.message;
      if (!data?.length) return "沒有儲存順序，請確認你的帳號權限。";
      return null;
    });
  }

  return (
    <>
      {err && <div className="msg err">{err}</div>}

      <div className="panel">
        <div className="panel-title">{type}系列</div>
        <p className="hint" style={{ marginTop: 0 }}>
          按住右邊的 ⠿ 上下拖，就是客人與盤點單上看到的順序。
        </p>
        <div className="filters" style={{ marginTop: "0.75rem" }}>
          <div className="f grow">
            <input
              value={adding} placeholder={`新增${type}系列名稱`}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addSeries(); }}
            />
          </div>
        </div>
        <button className="slim" style={{ marginTop: "0.625rem" }} disabled={busy || !adding.trim()} onClick={addSeries}>
          ➕ 新增系列
        </button>
      </div>

      {mine.length === 0 && (
        <div className="panel empty">
          <div className="emoji">🏷️</div>
          <p>還沒有{type}系列</p>
        </div>
      )}

      {mine.length > 0 && (
        <SortableRows items={mine} onReorder={reorderSeries}>
          {(s, handle) => (
            <div className="arow sort">
              {renaming?.id === s.id ? (
                <>
                  <div className="c grow">
                    <input
                      value={renaming.name} autoFocus
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") saveRename(s); }}
                    />
                  </div>
                  <div className="c acts">
                    <button className="slim" disabled={busy} onClick={() => saveRename(s)}>💾 儲存</button>
                    <button className="slim ghost" disabled={busy} onClick={() => setRenaming(null)}>↩️ 取消</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="c grow">
                    <b>{s.name}</b>
                    <span className="tag2">{countOf(s.name)} 項</span>
                  </div>
                  <div className="c acts">
                    <button className="slim outline" disabled={busy}
                      onClick={() => setRenaming({ id: s.id, name: s.name })}>
                      ✏️ 改名
                    </button>
                    <button className="slim outline danger" disabled={busy}
                      onClick={() => deleteSeries(s)}>
                      🗑️ 刪除
                    </button>
                    <span className="drag-handle" aria-hidden="true" {...handle}>⠿</span>
                  </div>
                </>
              )}
            </div>
          )}
        </SortableRows>
      )}

      <div className="panel" style={{ marginTop: "1.25rem" }}>
        <div className="panel-title">商品順序</div>
        <p className="hint" style={{ marginTop: 0 }}>
          只能在同一個系列裡上下拖。要換系列請到商品的編輯表單改「系列」。
        </p>
      </div>

      {[...order, UNCATEGORIZED].map((cat) => {
        const list = ofType.filter((it) => (it.category ?? UNCATEGORIZED) === cat);
        if (!list.length) return null;
        return (
          <div key={cat} style={{ marginBottom: "1.25rem" }}>
            <div className="section-label">{cat}（{list.length}）</div>
            <SortableRows items={list} onReorder={reorderItems}>
              {(it, handle) => (
                <div className={`arow sort${it.active ? "" : " off"}`}>
                  <div className="c grow">
                    <b>{it.code || it.name}</b>
                    {it.code && <span className="tag2">{it.name}</span>}
                    {!it.active && <span className="badge old">已停用</span>}
                  </div>
                  <div className="c acts">
                    <span className="drag-handle" aria-hidden="true" {...handle}>⠿</span>
                  </div>
                </div>
              )}
            </SortableRows>
          </div>
        );
      })}
    </>
  );
}
