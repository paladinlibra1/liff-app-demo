import { useMemo, useState } from "react";
import { expiryLevel, type Batch, type Item } from "./inventory";

/**
 * 過期／快到期／低於安全庫存的提醒。
 *
 * 看的是資料庫裡目前的批次，不是盤點作業中還沒送出的草稿——
 * 這是「現在店裡的狀況」，不該被還沒確定的輸入影響。
 */
export default function InventoryAlerts({ items, batches }: { items: Item[]; batches: Batch[] }) {
  const [open, setOpen] = useState(false);

  const { expired, soon, low } = useMemo(() => {
    const byItem = new Map<string, Batch[]>();
    for (const b of batches) {
      const arr = byItem.get(b.item_id);
      if (arr) arr.push(b); else byItem.set(b.item_id, [b]);
    }

    const expired: { item: Item; batch: Batch }[] = [];
    const soon: { item: Item; batch: Batch }[] = [];
    const low: { item: Item; qty: number; threshold: number }[] = [];

    for (const it of items) {
      const mine = byItem.get(it.id) ?? [];
      if (it.safety_stock !== null) {
        const qty = mine.reduce((s, b) => s + b.qty, 0);
        if (qty < it.safety_stock) low.push({ item: it, qty, threshold: it.safety_stock });
      }
      for (const b of mine) {
        const lv = expiryLevel(b.expiry_date);
        if (lv === "danger") expired.push({ item: it, batch: b });
        else if (lv === "warn") soon.push({ item: it, batch: b });
      }
    }
    // 快到期的先講最急的
    soon.sort((a, b) => (a.batch.expiry_date ?? "").localeCompare(b.batch.expiry_date ?? ""));
    return { expired, soon, low };
  }, [items, batches]);

  const total = expired.length + soon.length + low.length;
  if (!total) return null;

  const parts = [
    expired.length && `${expired.length} 個批次已過期`,
    soon.length && `${soon.length} 個批次快到期`,
    low.length && `${low.length} 項低於安全庫存`,
  ].filter(Boolean);

  const label = (it: Item) => `${it.code ? it.code + " " : ""}${it.name}`;

  return (
    <div className="panel alerts">
      <button className="slim ghost head" onClick={() => setOpen(!open)}>
        <span>⚠️ {parts.join("・")}</span>
        <span className="caret">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="alert-body">
          {expired.length > 0 && (
            <>
              <div className="section-label">🔴 已過期</div>
              {expired.map(({ item, batch }) => (
                <div className="alert-row" key={batch.id}>
                  <span>{label(item)}</span>
                  <span className="badge bad">效期 {batch.expiry_date}（{batch.qty}）</span>
                </div>
              ))}
            </>
          )}

          {soon.length > 0 && (
            <>
              <div className="section-label">🟡 90 天內到期</div>
              {soon.map(({ item, batch }) => (
                <div className="alert-row" key={batch.id}>
                  <span>{label(item)}</span>
                  <span className="badge warn">效期 {batch.expiry_date}（{batch.qty}）</span>
                </div>
              ))}
            </>
          )}

          {low.length > 0 && (
            <>
              <div className="section-label">📉 低於安全庫存</div>
              {low.map(({ item, qty, threshold }) => (
                <div className="alert-row" key={item.id}>
                  <span>{label(item)}</span>
                  <span className="badge old">目前 {qty} ／ 安全值 {threshold}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
