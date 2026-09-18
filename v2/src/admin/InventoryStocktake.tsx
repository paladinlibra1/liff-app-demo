import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import QtyKeypad from "./QtyKeypad";
import InventoryAlerts from "./InventoryAlerts";
import {
  BATCH_FIELDS, ITEM_FIELDS, ITEM_TYPES, UNCATEGORIZED,
  expiryLevel, itemComparator, seriesNames, todayStr,
  type Batch, type Item, type Series,
} from "./inventory";

/*
 * 盤點作業。
 *
 * 畫面一載入就把每一項商品的現有批次放進草稿，所以「沒點開過的商品」
 * 一樣是這次盤點的一部分（帳面＝實際、差異 0）。送出時涵蓋全部啟用商品，
 * 不是只有這次動到的那幾項——盤點單缺了幾項，事後就不知道是沒盤還是沒差異。
 *
 * 真正的寫入是資料庫函式 submit_stocktake：庫存與紀錄在同一個交易裡，
 * 不會出現「庫存改了但沒有紀錄」，按兩次也不會把新批次建兩次。
 */

interface DraftBatch {
  /** 畫面上的 key。既有批次用 batch_id，新加的用臨時字串 */
  key: string;
  batch_id: string | null;
  expiry_date: string;
  book_qty: number;
  actual_qty: number;
  is_new: boolean;
  /** 盤到東西不見了：既有批次標記刪除，送出時由資料庫刪掉 */
  removed: boolean;
}

type Draft = Record<string, { batches: DraftBatch[]; edited: boolean }>;

function buildDraft(items: Item[], batches: Batch[]): Draft {
  const d: Draft = {};
  for (const it of items) d[it.id] = { batches: [], edited: false };
  for (const b of batches) {
    const row = d[b.item_id];
    if (!row) continue;                       // 停用商品的批次，這頁不處理
    row.batches.push({
      key: b.id, batch_id: b.id,
      expiry_date: b.expiry_date ?? "",
      book_qty: b.qty, actual_qty: b.qty,
      is_new: false, removed: false,
    });
  }
  // 效期近的排前面，沒填效期的排最後——先出快過期的那一批是店裡的習慣
  for (const row of Object.values(d)) {
    row.batches.sort((a, b) => (a.expiry_date || "9999").localeCompare(b.expiry_date || "9999"));
  }
  return d;
}

export default function InventoryStocktake({ store }: { store: Store }) {
  const [type, setType] = useState<string>(ITEM_TYPES[0]);
  const [category, setCategory] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());

  const [items, setItems] = useState<Item[] | null>(null);
  /** 資料庫裡目前的批次。草稿是拿它建的，提醒那一塊也直接看它 */
  const [batches, setBatches] = useState<Batch[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [keypad, setKeypad] = useState<{ itemId: string; key: string } | null>(null);

  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const [i, b, s] = await Promise.all([
      supabase.from("inventory_items").select(ITEM_FIELDS).eq("store_id", store.id).eq("active", true),
      supabase.from("inventory_batches").select(BATCH_FIELDS).eq("store_id", store.id),
      supabase.from("inventory_series").select("id,type,name,sort_order").eq("store_id", store.id),
    ]);
    if (i.error || b.error || s.error) {
      setErr((i.error ?? b.error ?? s.error)!.message);
      return;
    }
    const list = i.data as Item[];
    const rows = b.data as Batch[];
    setItems(list);
    setBatches(rows);
    setSeries(s.data as Series[]);
    setDraft(buildDraft(list, rows));
    setOpenId(null);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  const order = useMemo(() => seriesNames(series, type), [series, type]);
  const ofType = useMemo(
    () => (items ?? []).filter((it) => it.type === type).sort(itemComparator(order)),
    [items, type, order],
  );
  const shown = category === null
    ? ofType
    : ofType.filter((it) => (it.category ?? UNCATEGORIZED) === category);

  const editedCount = Object.values(draft).filter((d) => d.edited).length;

  /** 改草稿一律走這裡，順便標記「這項動過了」 */
  function patch(itemId: string, fn: (rows: DraftBatch[]) => DraftBatch[]) {
    setOk("");
    setDraft((d) => {
      const row = d[itemId];
      if (!row) return d;
      return { ...d, [itemId]: { batches: fn(row.batches), edited: true } };
    });
  }

  function addBatch(itemId: string) {
    patch(itemId, (rows) => [...rows, {
      key: `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      batch_id: null, expiry_date: "", book_qty: 0, actual_qty: 0,
      is_new: true, removed: false,
    }]);
  }

  /** 新加的批次直接丟掉；既有的要留著標記 removed，送出時資料庫才知道要刪 */
  function removeBatch(itemId: string, key: string) {
    patch(itemId, (rows) => rows.flatMap((b) =>
      b.key !== key ? [b] : b.is_new ? [] : [{ ...b, removed: true }]));
  }

  function setBatch(itemId: string, key: string, p: Partial<DraftBatch>) {
    patch(itemId, (rows) => rows.map((b) => (b.key === key ? { ...b, ...p } : b)));
  }

  const liveBatches = (itemId: string) => (draft[itemId]?.batches ?? []).filter((b) => !b.removed);
  const totalQty = (itemId: string) =>
    liveBatches(itemId).reduce((s, b) => s + (Number(b.actual_qty) || 0), 0);
  const hasExpired = (itemId: string) =>
    liveBatches(itemId).some((b) => expiryLevel(b.expiry_date) === "danger");

  /**
   * 送出。涵蓋全部啟用商品：沒動過的用目前帳面數量（差異 0），
   * 連一個批次都沒有的也送一列，這樣盤點紀錄的品項數才等於商品總數。
   */
  async function submit() {
    if (submitting || !items) return;                 // 防連點
    if (!items.length) return setErr("目前沒有啟用中的商品可以盤點");
    if (!confirm(
      `確定要送出 ${date} 的盤點嗎？\n\n` +
      `會涵蓋全部 ${items.length} 項啟用中的商品（這次調整了 ${editedCount} 項），` +
      `庫存會直接更新成實際數量。`,
    )) return;

    setSubmitting(true); setErr(""); setOk("");
    const payload = items.flatMap((it) => {
      const rows = draft[it.id]?.batches ?? [];
      if (!rows.length) {
        return [{
          item_id: it.id, batch_id: null, expiry_date: null,
          book_qty: 0, actual_qty: 0, is_new: false, removed: false,
        }];
      }
      return rows.map((b) => ({
        item_id: it.id,
        batch_id: b.batch_id,
        expiry_date: b.expiry_date || null,
        book_qty: b.book_qty,
        actual_qty: b.removed ? 0 : (Number(b.actual_qty) || 0),
        is_new: b.is_new,
        removed: b.removed,
      }));
    });

    const { error } = await supabase.rpc("submit_stocktake", {
      p_store_id: store.id, p_date: date, p_items: payload,
    });

    if (error) setErr(`送出失敗：${error.message}`);
    else {
      setOk(`已送出 ${date} 的盤點，庫存已更新。`);
      // 重讀才拿得到剛剛新建批次的 id；沒重讀就再按一次會重複建立
      await load();
    }
    setSubmitting(false);
  }

  return (
    <>
      {items && <InventoryAlerts items={items} batches={batches} />}

      <div className="panel">
        <label>類型</label>
        <div className="seg">
          {ITEM_TYPES.map((t) => (
            <button
              key={t} type="button" aria-pressed={type === t}
              onClick={() => { setType(t); setCategory(null); setOpenId(null); }}
            >
              {t}
            </button>
          ))}
        </div>

        <label style={{ marginTop: "0.875rem" }}>系列</label>
        <div className="chips" style={{ marginTop: 0 }}>
          <button
            type="button" className="chip" aria-pressed={category === null}
            onClick={() => { setCategory(null); setOpenId(null); }}
          >
            全部（{ofType.length}）
          </button>
          {[...order, UNCATEGORIZED].map((c) => {
            const n = ofType.filter((it) => (it.category ?? UNCATEGORIZED) === c).length;
            if (!n) return null;
            return (
              <button
                key={c} type="button" className="chip" aria-pressed={category === c}
                onClick={() => { setCategory(c); setOpenId(null); }}
              >
                {c}（{n}）
              </button>
            );
          })}
        </div>
        <p className="hint">
          點商品可以展開改數量。沒點開的商品也算在這次盤點裡，數量維持帳面、差異 0。
        </p>
      </div>

      {err && <div className="msg err">{err}</div>}
      {ok && <div className="msg ok">{ok}</div>}

      {items === null && <div className="panel"><div className="skeleton" style={{ height: "4rem" }} /></div>}

      {items && shown.length === 0 && (
        <div className="panel empty">
          <div className="emoji">📦</div>
          <p>這個系列沒有啟用中的商品</p>
        </div>
      )}

      <div className="rows" style={{ paddingBottom: "5.5rem" }}>
        {shown.map((it, i) => {
          const cat = it.category ?? UNCATEGORIZED;
          const newSeries = category === null && (i === 0 || (shown[i - 1].category ?? UNCATEGORIZED) !== cat);
          const rows = liveBatches(it.id);
          const open = openId === it.id;
          const qty = totalQty(it.id);
          const low = it.safety_stock !== null && qty < it.safety_stock;

          return (
            <div key={it.id}>
              {newSeries && <div className="section-label" style={{ marginTop: i ? "0.875rem" : 0 }}>{cat}</div>}

              <div className="arow stock">
                <div
                  className="c grow" role="button" tabIndex={0} style={{ cursor: "pointer" }}
                  onClick={() => setOpenId(open ? null : it.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(open ? null : it.id); } }}
                >
                  <b>{it.code || it.name}</b>
                  {it.code && <span className="tag2">{it.name}</span>}
                  <div className="sub" style={{ marginTop: "0.1875rem" }}>
                    {rows.length ? `${rows.length} 批次` : "尚無批次"}
                    {draft[it.id]?.edited && <span className="tag2 line">已調整</span>}
                  </div>
                </div>

                <div className="c qty">
                  <span className={`qty-total${hasExpired(it.id) ? " bad" : low ? " low" : ""}`}>{qty}</span>
                  <span className="caret" aria-hidden="true">{open ? "▲" : "▼"}</span>
                </div>

                {open && (
                  <div className="expand">
                    {rows.length === 0 && (
                      <p className="hint" style={{ marginTop: 0 }}>庫存 0，還沒有批次。進了貨就按底下的「新增批次」。</p>
                    )}

                    {rows.map((b) => {
                      const lv = expiryLevel(b.expiry_date);
                      const diff = (Number(b.actual_qty) || 0) - b.book_qty;
                      return (
                        <div className="batch" key={b.key}>
                          <div className="batch-top">
                            <input
                              type="date" value={b.expiry_date}
                              onChange={(e) => setBatch(it.id, b.key, { expiry_date: e.target.value })}
                            />
                            {lv && <span className={`badge ${lv === "danger" ? "bad" : "warn"}`}>
                              {lv === "danger" ? "已過期" : "快到期"}
                            </span>}
                            <button
                              className="slim ghost x" title="移除這一批"
                              onClick={() => removeBatch(it.id, b.key)}
                            >
                              ✕
                            </button>
                          </div>

                          <div className="batch-qty">
                            {!b.is_new && <span className="book">帳面 {b.book_qty}</span>}
                            <button
                              className="qty-btn"
                              onClick={() => setKeypad({ itemId: it.id, key: b.key })}
                            >
                              實際 <b>{b.actual_qty}</b>
                            </button>
                            <span className={`diff ${b.is_new ? "new" : diff > 0 ? "pos" : diff < 0 ? "neg" : "zero"}`}>
                              {b.is_new ? "新批次" : diff > 0 ? `+${diff}` : diff}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    <button className="slim outline" onClick={() => addBatch(it.id)}>➕ 新增批次</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 送出列固定在畫面底下：盤到一半不用捲回最上面才找得到按鈕 */}
      {items && items.length > 0 && (
        <div className="stock-bar">
          <div className="info">
            <b>{items.length}</b> 項商品
            <span className="sub">（已調整 {editedCount} 項）</span>
          </div>
          <input
            type="date" value={date} aria-label="盤點日期"
            onChange={(e) => setDate(e.target.value)}
          />
          <button className="slim" disabled={submitting} onClick={submit}>
            {submitting ? "⏳ 送出中…" : "📤 送出盤點"}
          </button>
        </div>
      )}

      {keypad && (() => {
        const it = items?.find((x) => x.id === keypad.itemId);
        const b = draft[keypad.itemId]?.batches.find((x) => x.key === keypad.key);
        if (!it || !b) return null;
        return (
          <QtyKeypad
            label={`${it.code ? it.code + " " : ""}${it.name}`}
            value={b.actual_qty}
            onClose={() => setKeypad(null)}
            onConfirm={(n) => { setBatch(keypad.itemId, keypad.key, { actual_qty: n }); setKeypad(null); }}
          />
        );
      })()}
    </>
  );
}
