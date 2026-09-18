import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Store } from "./AdminShell";
import {
  ITEM_FIELDS, ITEM_TYPES, UNCATEGORIZED,
  itemComparator, seriesNames,
  type Item, type Series,
} from "./inventory";

/**
 * 商品管理。
 *
 * 搬自舊系統 inventory.html 的「🏷️ 商品管理」分頁：產品與護理品各有各的系列，
 * 清單先顯示一行摘要，點一下才展開成編輯表單——商品有十個欄位，
 * 八十幾項全部攤開的話要滾很久才找得到要改的那一項。
 */
export default function InventoryItems({ store }: { store: Store }) {
  const [type, setType] = useState<string>(ITEM_TYPES[0]);
  /** null = 全部；否則只看這個系列（可能是「未分類」） */
  const [category, setCategory] = useState<string | null>(null);

  const [items, setItems] = useState<Item[] | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [err, setErr] = useState("");

  /** 目前展開的商品 id；"new" 代表正在新增 */
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Item> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    const [i, s] = await Promise.all([
      supabase.from("inventory_items").select(ITEM_FIELDS).eq("store_id", store.id),
      supabase.from("inventory_series").select("id,type,name,sort_order").eq("store_id", store.id),
    ]);
    if (i.error || s.error) {
      setErr((i.error ?? s.error)!.message);
      return;
    }
    setItems(i.data as Item[]);
    setSeries(s.data as Series[]);
  }, [store.id]);

  useEffect(() => { void load(); }, [load]);

  /** 目前類型的系列順序，未分類永遠排在最後 */
  const order = useMemo(() => seriesNames(series, type), [series, type]);

  const ofType = useMemo(
    () => (items ?? []).filter((it) => it.type === type).sort(itemComparator(order)),
    [items, type, order],
  );

  /** 系列 → 商品數。篩選籤要顯示數量，空的系列也要列出來（才進得去把商品改進來） */
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of ofType) {
      const c = it.category ?? UNCATEGORIZED;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [ofType]);

  const shown = category === null
    ? ofType
    : ofType.filter((it) => (it.category ?? UNCATEGORIZED) === category);

  /** 切換類型時，前一個類型的系列篩選在這裡沒有意義，收掉 */
  function switchType(t: string) {
    setType(t);
    setCategory(null);
    closeEdit();
  }

  function closeEdit() {
    setOpenId(null);
    setDraft(null);
  }

  function openItem(it: Item) {
    if (openId === it.id) return closeEdit();
    setOpenId(it.id);
    setDraft({ ...it });
  }

  function startAdd() {
    setOpenId("new");
    setDraft({
      code: "", name: "", type,
      // 正在看某個系列就預填那個；看「全部」時預填第一個系列
      category: category === UNCATEGORIZED ? null : (category ?? order[0] ?? null),
      unit: "", member_price: 0, pv: 0, safety_stock: null, note: "", active: true,
    });
  }

  /** 類型換了，系列選單也要跟著換；原本選的系列不屬於新類型就清掉 */
  function changeDraftType(t: string) {
    if (!draft) return;
    const ok = seriesNames(series, t).includes(draft.category ?? "");
    setDraft({ ...draft, type: t, category: ok ? draft.category : null });
  }

  async function save() {
    if (saving || !draft) return;                 // 防連點
    const name = (draft.name ?? "").trim();
    if (!name) return setErr("請填商品名稱");

    setErr("");
    setSaving(true);
    const payload = {
      store_id: store.id,
      code: (draft.code ?? "").trim(),
      name,
      type: draft.type ?? type,
      category: draft.category || null,
      unit: (draft.unit ?? "").trim(),
      member_price: Number(draft.member_price) || 0,
      pv: Number(draft.pv) || 0,
      // 沒填＝不提醒低庫存，要存 null 而不是 0（0 會變成「永遠不缺貨」）
      safety_stock: draft.safety_stock === null || draft.safety_stock === undefined
        ? null : Number(draft.safety_stock),
      note: (draft.note ?? "").trim(),
      active: draft.active !== false,
    };

    // 帶 .select()：被 RLS 擋下的寫入不會回錯誤，只會回 0 列
    const { data, error } = draft.id
      ? await supabase.from("inventory_items").update(payload).eq("id", draft.id).select("id")
      : await supabase.from("inventory_items").insert(payload).select("id");

    if (error) setErr(error.message);
    else if (!data || data.length === 0) setErr("沒有儲存成功，請確認你的帳號權限。");
    else {
      closeEdit();
      await load();
    }
    setSaving(false);
  }

  /**
   * 刪除商品。批次是 on delete cascade，會一起消失——
   * 只是停賣的話請改用「啟用」開關，庫存數字才留得住。
   */
  async function remove(it: Item) {
    if (deleting || saving) return;               // 防連點
    if (!confirm(
      `確定要刪除商品「${it.name}」嗎？\n\n` +
      `它的所有批次庫存會一起刪除，無法復原。\n` +
      `如果只是暫時不賣，請把下面的「啟用」關掉就好。`,
    )) return;

    setDeleting(true); setErr("");
    const { data, error } = await supabase
      .from("inventory_items").delete().eq("id", it.id).select("id");

    if (error) setErr(error.message);
    else if (!data || data.length === 0) setErr("沒有刪除成功，請確認你的帳號權限。");
    else {
      closeEdit();
      await load();
    }
    setDeleting(false);
  }

  return (
    <>
      <div className="panel">
        <label>類型</label>
        <div className="seg">
          {ITEM_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => switchType(t)}>
              {t}
            </button>
          ))}
        </div>

        <label style={{ marginTop: "0.875rem" }}>系列</label>
        <div className="chips" style={{ marginTop: 0 }}>
          <button
            type="button" className="chip" aria-pressed={category === null}
            onClick={() => { setCategory(null); closeEdit(); }}
          >
            全部（{ofType.length}）
          </button>
          {order.map((c) => (
            <button
              key={c} type="button" className="chip" aria-pressed={category === c}
              onClick={() => { setCategory(c); closeEdit(); }}
            >
              {c}（{counts.get(c) ?? 0}）
            </button>
          ))}
          {(counts.get(UNCATEGORIZED) ?? 0) > 0 && (
            <button
              type="button" className="chip" aria-pressed={category === UNCATEGORIZED}
              onClick={() => { setCategory(UNCATEGORIZED); closeEdit(); }}
            >
              {UNCATEGORIZED}（{counts.get(UNCATEGORIZED)}）
            </button>
          )}
        </div>

        <button className="slim" style={{ marginTop: "0.875rem" }} onClick={startAdd}>
          ➕ 新增商品
        </button>
      </div>

      {err && <div className="msg err">{err}</div>}

      {openId === "new" && draft && (
        <div className="panel">
          <div className="panel-title">新增商品</div>
          <ItemForm
            draft={draft} setDraft={setDraft} series={series}
            onTypeChange={changeDraftType}
          />
          <div className="bk-acts">
            <button className="slim" disabled={saving} onClick={save}>
              {saving ? "⏳ 儲存中…" : "💾 儲存"}
            </button>
            <button className="slim ghost" onClick={closeEdit}>↩️ 取消</button>
          </div>
        </div>
      )}

      {items === null && <div className="panel"><div className="skeleton" style={{ height: "4rem" }} /></div>}

      {items && shown.length === 0 && (
        <div className="panel empty">
          <div className="emoji">📦</div>
          <p>這個系列還沒有商品</p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="rows">
          {shown.map((it) => {
            const open = openId === it.id;
            return (
              <div className={`arow${it.active ? "" : " off"}`} key={it.id}>
                {/* 摘要列整條可以點，展開才看得到十個欄位 */}
                <div
                  className="c who" role="button" tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={() => openItem(it)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openItem(it); } }}
                >
                  <b>{it.code || it.name}</b>
                  {it.code && <span className="tag2">{it.name}</span>}
                  {!it.active && <span className="badge old">已停用</span>}
                  <div className="sub" style={{ marginTop: "0.1875rem" }}>
                    {it.category ?? UNCATEGORIZED}
                    {it.unit && ` · ${it.unit}`}
                    {it.member_price > 0 && ` · $${it.member_price}`}
                  </div>
                </div>

                <div className="c acts">
                  <button className="slim outline" onClick={() => openItem(it)}>
                    {open ? "▲ 收合" : "✏️ 編輯"}
                  </button>
                </div>

                {open && draft && (
                  <div className="expand">
                    <ItemForm
                      draft={draft} setDraft={setDraft} series={series}
                      onTypeChange={changeDraftType}
                    />
                    <div className="bk-acts">
                      <button className="slim" disabled={saving} onClick={save}>
                        {saving ? "⏳ 儲存中…" : "💾 儲存"}
                      </button>
                      <button className="slim ghost" onClick={closeEdit}>↩️ 取消</button>
                      <button
                        className="slim outline danger" disabled={deleting}
                        onClick={() => remove(it)}
                      >
                        {deleting ? "⏳ 刪除中…" : "🗑️ 刪除"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 新增與編輯共用同一份表單，欄位只寫一次 */
function ItemForm({
  draft, setDraft, series, onTypeChange,
}: {
  draft: Partial<Item>;
  setDraft: (d: Partial<Item>) => void;
  series: Series[];
  onTypeChange: (t: string) => void;
}) {
  const cats = seriesNames(series, draft.type ?? ITEM_TYPES[0]);
  const set = (patch: Partial<Item>) => setDraft({ ...draft, ...patch });

  return (
    <div className="form-grid">
      <div className="field">
        <label>代碼</label>
        <input
          value={draft.code ?? ""} placeholder="例如 AB90"
          onChange={(e) => set({ code: e.target.value })}
        />
      </div>

      <div className="field">
        <label>商品名稱</label>
        <input value={draft.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="field">
        <label>類型</label>
        <select value={draft.type ?? ITEM_TYPES[0]} onChange={(e) => onTypeChange(e.target.value)}>
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="field">
        <label>系列</label>
        <select
          value={draft.category ?? ""}
          onChange={(e) => set({ category: e.target.value || null })}
        >
          <option value="">（{UNCATEGORIZED}）</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="field">
        <label>單位</label>
        <input
          value={draft.unit ?? ""} placeholder="例如 瓶、盒"
          onChange={(e) => set({ unit: e.target.value })}
        />
      </div>

      <div className="field">
        <label>會員價</label>
        <input
          type="number" inputMode="numeric" value={draft.member_price ?? 0}
          onChange={(e) => set({ member_price: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label>PV</label>
        <input
          type="number" inputMode="decimal" step="0.01" value={draft.pv ?? 0}
          onChange={(e) => set({ pv: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label>安全庫存量</label>
        <input
          type="number" inputMode="numeric" placeholder="不填＝不提醒"
          value={draft.safety_stock ?? ""}
          onChange={(e) => set({ safety_stock: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <p className="hint">庫存低於這個數字時會在盤點作業提醒補貨。</p>
      </div>

      <div className="field wide">
        <label>備註（可不填）</label>
        <textarea value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} />
      </div>

      <div className="field wide">
        <label className="check" style={{ display: "inline-flex" }}>
          <input
            type="checkbox" checked={draft.active !== false}
            onChange={(e) => set({ active: e.target.checked })}
          />
          啟用
        </label>
        <p className="hint">關掉之後，這項商品不會出現在盤點作業，但庫存數字會留著。</p>
      </div>
    </div>
  );
}
