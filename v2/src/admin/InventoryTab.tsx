import { useState } from "react";
import type { Store } from "./AdminShell";
import InventoryItems from "./InventoryItems";

/*
 * 庫存盤點。舊系統是另一個網頁（inventory.html），從後台用連結跳過去；
 * 這裡直接做成分頁，店員不用再記第二個網址、也不用再登入一次。
 *
 * 底下還會有「盤點作業」與「盤點歷史」兩個子分頁，還沒做完，
 * 所以子分頁列只有一項時先不畫出來——一顆孤零零的按鈕看起來像壞掉。
 */
type SubKey = "items";

const SUBS: { key: SubKey; label: string }[] = [
  { key: "items", label: "🏷️ 商品管理" },
];

export default function InventoryTab({ store }: { store: Store }) {
  const [sub, setSub] = useState<SubKey>("items");

  return (
    <>
      {SUBS.length > 1 && (
        <div className="tabs admin-tabs">
          {SUBS.map((s) => (
            <button key={s.key} type="button" aria-pressed={sub === s.key} onClick={() => setSub(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {sub === "items" && <InventoryItems store={store} />}
    </>
  );
}
