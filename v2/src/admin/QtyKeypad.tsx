import { useState } from "react";

/*
 * 實際數量的九宮格鍵盤。
 *
 * 盤點是站在櫃子前面單手拿手機數東西，叫出系統鍵盤的話一半畫面會被蓋住、
 * 還常常誤觸到別的欄位。所以數量欄位設成唯讀，點下去改叫這個大按鍵的面板。
 */
export default function QtyKeypad({
  label, value, onConfirm, onClose,
}: {
  /** 面板上顯示的商品，讓人確認自己點到的是哪一項 */
  label: string;
  value: number;
  onConfirm: (n: number) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(String(value));
  /** 還沒按過任何鍵：第一個數字是「取代」而不是「接在後面」 */
  const [fresh, setFresh] = useState(true);

  function digit(d: string) {
    setText((t) => (fresh || t === "0" ? (d === "0" && fresh ? "0" : d) : t.length < 6 ? t + d : t));
    setFresh(false);
  }

  return (
    <div className="keypad-back" onClick={onClose}>
      <div className="keypad" onClick={(e) => e.stopPropagation()}>
        <div className="keypad-head">
          <div className="k-label">{label}</div>
          <div className="k-value">{text || "0"}</div>
        </div>

        <div className="keypad-grid">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} type="button" className="k" onClick={() => digit(d)}>{d}</button>
          ))}
          <button type="button" className="k ghost" onClick={() => { setText("0"); setFresh(true); }}>C</button>
          <button type="button" className="k" onClick={() => digit("0")}>0</button>
          <button type="button" className="k ghost" onClick={() => { setText((t) => t.slice(0, -1) || "0"); setFresh(false); }}>⌫</button>
        </div>

        <div className="bk-acts">
          <button className="slim" onClick={() => onConfirm(Number(text) || 0)}>✓ 確定</button>
          <button className="slim ghost" onClick={onClose}>↩️ 取消</button>
        </div>
      </div>
    </div>
  );
}
