/*
 * 庫存盤點共用的型別與排序規則。
 *
 * 商品管理、盤點作業、盤點歷史三個子分頁都要用同一套排序，
 * 各寫一份的話「商品管理排第三的那罐」在盤點時跑到第五，店員會對不上。
 */

export const ITEM_TYPES = ["產品", "護理品"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** 畫面上的保留字：category 為 null 的商品都歸在這一格，資料庫不會有同名系列 */
export const UNCATEGORIZED = "未分類";

export interface Series {
  id: string;
  type: string;
  name: string;
  sort_order: number;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  type: string;
  category: string | null;
  unit: string;
  member_price: number;
  pv: number;
  safety_stock: number | null;
  note: string;
  active: boolean;
  sort_order: number | null;
}

export const ITEM_FIELDS =
  "id,code,name,type,category,unit,member_price,pv,safety_stock,note,active,sort_order";

/** 某個類型的系列名稱，依 sort_order 排列 */
export function seriesNames(series: Series[], type: string): string[] {
  return series
    .filter((s) => s.type === type)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => s.name);
}

/**
 * 商品排序：先系列順序，再系列內的手動順序，最後才是代碼。
 *
 * 沒設過 sort_order 的排在有設的後面（而不是當成 0 插到最前面）——
 * 店員只會去拖他在意的那幾項，沒動過的不該因此跳到前面。
 * 不在系列清單裡的（含未分類）一律排到最後。
 */
export function itemComparator(order: string[]) {
  const rank = new Map(order.map((n, i) => [n, i]));
  const catRank = (it: Item) => rank.get(it.category ?? UNCATEGORIZED) ?? Number.MAX_SAFE_INTEGER;
  const sortRank = (it: Item) => (it.sort_order ?? Number.MAX_SAFE_INTEGER);

  return (a: Item, b: Item) =>
    catRank(a) - catRank(b) ||
    sortRank(a) - sortRank(b) ||
    a.code.localeCompare(b.code, "zh-Hant") ||
    a.name.localeCompare(b.name, "zh-Hant");
}

export interface Batch {
  id: string;
  item_id: string;
  expiry_date: string | null;
  qty: number;
  note: string;
}

export const BATCH_FIELDS = "id,item_id,expiry_date,qty,note";

/** 快到期的定義：90 天內。沿用舊系統，盤點時看到黃色就知道要先出這一批 */
export const EXPIRY_WARN_DAYS = 90;

export function expiryLevel(date: string | null | undefined): "" | "warn" | "danger" {
  if (!date) return "";
  const days = (new Date(date + "T00:00:00").getTime() - Date.now()) / 86400000;
  if (days < 0) return "danger";
  if (days <= EXPIRY_WARN_DAYS) return "warn";
  return "";
}

/** 今天，YYYY-MM-DD（用本地時間，不是 UTC——台灣早上八點前會差一天） */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
