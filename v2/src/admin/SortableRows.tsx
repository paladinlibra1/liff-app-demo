import { useCallback, useEffect, useRef, useState } from "react";

/*
 * 按住握把拖曳排序的清單。
 *
 * 拖曳期間完全不動 DOM 順序，只用 transform 讓每一列看起來已經讓開；
 * 放手才把新順序交給上層寫回資料庫。中途要是寫入失敗，畫面本來就還沒改。
 *
 * 位置一律用「頁面座標」（clientY + scrollY）計算，這樣拖到畫面邊緣自動捲動時
 * 不會因為捲動而誤判自己滑過了好幾列。
 */

interface Rect { top: number; height: number }

interface DragState {
  index: number;
  target: number;
  /** 按下去那一刻的頁面座標，用來算位移 */
  startPageY: number;
  pageY: number;
  /** 最新的視窗座標，自動捲動時要靠它判斷離邊緣多近 */
  clientY: number;
  rects: Rect[];
  /** 列與列的間距，從實際位置量出來（後台根字級是 90%，寫死 px 會差一點） */
  gap: number;
}

/** 拖到上下緣多少距離內開始自動捲動 */
const EDGE = 90;

export default function SortableRows<T extends { id: string }>({
  items, onReorder, children,
}: {
  items: T[];
  /** 放手後的新順序。回傳的 promise 結束（含失敗）就代表資料庫那邊已經重讀完 */
  onReorder: (ordered: T[]) => Promise<void> | void;
  children: (item: T, handle: HandleProps) => React.ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  /*
   * 放手後先照新順序畫，等上層寫完並重讀資料庫才交還給 items。
   * 少了這一步，從放手到資料回來的那一瞬間，清單會先彈回原位再跳一次。
   */
  const [optimistic, setOptimistic] = useState<T[] | null>(null);
  const rows = optimistic ?? items;
  /** 事件處理器裡要讀到最新的狀態，但又不能讓它們每次重綁 */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  /** 依目前位移算出這一列該插到第幾個位置 */
  const targetOf = useCallback((d: DragState) => {
    const delta = d.pageY - d.startPageY;
    const me = d.rects[d.index];
    if (!me) return d.index;
    const center = me.top + delta + me.height / 2;
    let target = d.index;
    for (let i = 0; i < d.rects.length; i++) {
      const c = d.rects[i].top + d.rects[i].height / 2;
      if (i < d.index && center < c) { target = i; break; }
      if (i > d.index && center > c) { target = i; }
    }
    return target;
  }, []);

  const move = useCallback((clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const next = { ...d, clientY, pageY: clientY + window.scrollY };
    next.target = targetOf(next);
    setDrag(next);
  }, [targetOf]);

  function start(e: React.PointerEvent, index: number) {
    if (e.button > 0) return;
    const els = [...(wrap.current?.querySelectorAll<HTMLElement>("[data-sortrow]") ?? [])];
    if (els.length < 2) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rects = els.map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top + window.scrollY, height: b.height };
    });
    const pageY = e.clientY + window.scrollY;
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - (rects[0].top + rects[0].height)) : 0;
    setDrag({ index, target: index, startPageY: pageY, pageY, clientY: e.clientY, rects, gap });
  }

  async function end() {
    const d = dragRef.current;
    setDrag(null);
    if (!d || d.target === d.index) return;
    const next = [...rows];
    const [row] = next.splice(d.index, 1);
    next.splice(d.target, 0, row);
    setOptimistic(next);
    try {
      await onReorder(next);
    } finally {
      // 寫入失敗時也要放掉，這樣畫面才會回到資料庫裡真正的順序
      setOptimistic(null);
    }
  }

  // 拖到畫面上下緣就自動捲動，長清單才有辦法一路拖到底
  useEffect(() => {
    if (!drag) return;
    const timer = setInterval(() => {
      const d = dragRef.current;
      if (!d) return;
      const y = d.clientY;
      if (y < EDGE) window.scrollBy(0, -Math.ceil((EDGE - y) / 4));
      else if (y > window.innerHeight - EDGE) window.scrollBy(0, Math.ceil((y - (window.innerHeight - EDGE)) / 4));
      else return;
      move(y);   // 捲動後頁面座標變了，重算一次
    }, 60);
    return () => clearInterval(timer);
  }, [drag, move]);

  /** 拖曳中每一列該偏移多少：自己跟著手指，被越過的往回讓一格 */
  function offsetOf(i: number): React.CSSProperties | undefined {
    if (!drag) return undefined;
    const me = drag.rects[drag.index];
    if (i === drag.index) {
      return {
        transform: `translateY(${drag.pageY - drag.startPageY}px) scale(1.02)`,
        position: "relative", zIndex: 5,
      };
    }
    const step = me ? me.height + drag.gap : 0;
    if (drag.index < i && i <= drag.target) return { transform: `translateY(${-step}px)` };
    if (drag.target <= i && i < drag.index) return { transform: `translateY(${step}px)` };
    return undefined;
  }

  return (
    <div className="rows sortable" ref={wrap}>
      {rows.map((it, i) => (
        <div
          key={it.id} data-sortrow="1"
          className={`sort-row${drag?.index === i ? " dragging" : ""}`}
          style={offsetOf(i)}
        >
          {children(it, {
            onPointerDown: (e) => start(e, i),
            onPointerMove: (e) => { if (dragRef.current) { e.preventDefault(); move(e.clientY); } },
            onPointerUp: () => { void end(); },
            onPointerCancel: () => { void end(); },
          })}
        </div>
      ))}
    </div>
  );
}

export interface HandleProps {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}
