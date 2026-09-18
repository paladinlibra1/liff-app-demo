import { useState } from "react";
import type { Store } from "./AdminShell";
import InventoryItems from "./InventoryItems";
import InventoryStocktake from "./InventoryStocktake";
import InventoryHistory from "./InventoryHistory";

/*
 * 庫存盤點。舊系統是另一個網頁（inventory.html），從後台用連結跳過去；
 * 這裡直接做成分頁，店員不用再記第二個網址、也不用再登入一次。
 *
 * 子分頁的順序照實際做事的順序：平常開的是盤點作業，商品管理是偶爾才進去的。
 */
type SubKey = "stocktake" | "items" | "history";

const SUBS: { key: SubKey; label: string }[] = [
  { key: "stocktake", label: "📋 盤點作業" },
  { key: "items", label: "🏷️ 商品管理" },
  { key: "history", label: "🕘 盤點歷史" },
];

export default function InventoryTab({ store }: { store: Store }) {
  const [sub, setSub] = useState<SubKey>("stocktake");

  return (
    <>
      {/* 不用 .admin-tabs：那個類別在手機上會被藏起來換成漢堡選單，
          但子分頁只有兩個，手機上排得下，也不該再多一層選單 */}
      <div className="tabs">
        {SUBS.map((s) => (
          <button key={s.key} type="button" aria-pressed={sub === s.key} onClick={() => setSub(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {sub === "stocktake" && <InventoryStocktake store={store} />}
      {sub === "items" && <InventoryItems store={store} />}
      {sub === "history" && <InventoryHistory store={store} />}
    </>
  );
}
