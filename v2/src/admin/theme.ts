/**
 * 後台配色
 *
 * 預設值寫在 styles.css 的 `body.admin-theme`。店家在設定分頁選了顏色之後，
 * 這裡把它們蓋到 body 的 inline style 上——inline 的優先度高於樣式表，
 * 所以不必動 CSS，也不用重新部署。
 *
 * 開放九個顏色。其餘（按壓色、輸入框底、最淡的提示字、細分隔線）由它們推算：
 * 那些值本來就跟某個顏色綁在一起，各自獨立設定只會調出不協調的組合。
 */

export interface Theme {
  /** 按鈕與強調色 */
  primary: string;
  /** 頁面底色 */
  bg: string;
  /** 主要文字 */
  ink: string;
  /** 次要文字（說明、標籤） */
  inkSoft: string;
  /** 卡片底 */
  card: string;
  /** 卡片、輸入框的邊框 */
  border: string;
  /** 分頁列底槽 */
  tabs: string;
  /** 次要按鈕底 */
  btn2: string;
  /** 次要按鈕字 */
  btn2Ink: string;
}

export type ThemeKey = keyof Theme;

export const HEX = /^#[0-9a-fA-F]{6}$/;

/** styles.css 裡 body.admin-theme 的預設值，兩邊要一致 */
export const DEFAULT_THEME: Theme = {
  primary: "#c2585a",
  bg: "#fafafa",
  ink: "#1a1510",
  inkSoft: "#655442",
  card: "#ffffff",
  border: "#dfd3ca",
  tabs: "#f0e9e3",
  btn2: "#f3efeb",
  btn2Ink: "#655442",
};

/** 每個顏色存在 stores 的哪一欄 */
export const THEME_COLUMNS = {
  primary: "theme_primary",
  bg: "theme_bg",
  ink: "theme_ink",
  inkSoft: "theme_ink_soft",
  card: "theme_card",
  border: "theme_border",
  tabs: "theme_tabs",
  btn2: "theme_btn2",
  btn2Ink: "theme_btn2_ink",
} as const satisfies Record<ThemeKey, string>;

type ThemeRow = { [K in (typeof THEME_COLUMNS)[ThemeKey]]: string | null };

/** 資料庫那一列 → 完整配色（null 補預設） */
export function themeFromRow(row: Partial<ThemeRow> | null | undefined): Theme {
  const out = { ...DEFAULT_THEME };
  for (const k of Object.keys(THEME_COLUMNS) as ThemeKey[]) {
    const v = row?.[THEME_COLUMNS[k]];
    if (v && HEX.test(v)) out[k] = v;
  }
  return out;
}

/** 完整配色 → 要寫回資料庫的欄位 */
export function themeToRow(theme: Theme): ThemeRow {
  const out = {} as ThemeRow;
  for (const k of Object.keys(THEME_COLUMNS) as ThemeKey[]) out[THEME_COLUMNS[k]] = theme[k];
  return out;
}


function toRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** 往黑色靠 `amount`（0～1）。按壓狀態用 */
export function darken(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/** 往白色靠 `amount`（0～1）。輸入框底色用 */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** WCAG 相對亮度 */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 兩個顏色的對比。文字要 4.5 以上才讀得清楚。
 *
 * 不擋住存檔——顏色是店家的選擇，我們只負責告訴他會看不清楚。
 */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 按鈕是白字 */
export function contrastWithWhite(hex: string): number {
  return contrast(hex, "#ffffff");
}

/**
 * 套用配色。
 *
 * 掛在 body 而不是某個容器：token 定義在 body.admin-theme 上，
 * 蓋在同一個元素才蓋得過去。
 *
 * 跟預設一樣的顏色就不蓋，讓樣式表的值生效——
 * 推算出來的衍生色跟 styles.css 裡手調的不會完全一樣。
 */
export function applyTheme(theme: Partial<Theme> | null): void {
  const style = document.body.style;
  const pick = (k: ThemeKey) => {
    const v = theme?.[k];
    return v && HEX.test(v) && v.toLowerCase() !== DEFAULT_THEME[k] ? v : null;
  };
  const set = (vars: Record<string, string>, on: boolean) => {
    for (const [name, value] of Object.entries(vars)) {
      if (on) style.setProperty(name, value); else style.removeProperty(name);
    }
  };

  const primary = pick("primary");
  set({ "--rose": primary ?? "", "--rose-deep": primary ? darken(primary, 0.14) : "" }, !!primary);

  const bg = pick("bg");
  // 輸入框底比頁面底再亮一點，卡片是純白，三層才分得出來
  set({ "--rose-tint": bg ?? "", "--rose-wash": bg ? lighten(bg, 0.5) : "", background: bg ?? "" }, !!bg);

  const ink = pick("ink");
  set({ "--ink": ink ?? "" }, !!ink);

  const inkSoft = pick("inkSoft");
  // 最淡的提示字（placeholder、表頭）是次要文字再淡一階
  set({ "--ink-soft": inkSoft ?? "", "--muted": inkSoft ? lighten(inkSoft, 0.4) : "" }, !!inkSoft);

  const card = pick("card");
  set({ "--card": card ?? "" }, !!card);

  const border = pick("border");
  // 列與列之間的細線比外框淡一點
  set({
    "--line-strong": border ?? "",
    "--rose-soft": border ?? "",
    "--line": border ? lighten(border, 0.35) : "",
  }, !!border);

  const tabs = pick("tabs");
  set({ "--tabs-bg": tabs ?? "", "--tabs-border": tabs ? darken(tabs, 0.04) : "" }, !!tabs);

  const btn2 = pick("btn2");
  set({ "--btn2-bg": btn2 ?? "", "--btn2-bg-active": btn2 ? darken(btn2, 0.05) : "" }, !!btn2);

  const btn2Ink = pick("btn2Ink");
  set({ "--btn2-ink": btn2Ink ?? "" }, !!btn2Ink);
}

/** 幾組調好的，省得自己一個一個試 */
const preset = (t: Partial<Theme>): Theme => ({ ...DEFAULT_THEME, ...t });

export const PRESETS: { name: string; theme: Theme }[] = [
  { name: "暖白（預設）", theme: DEFAULT_THEME },
  {
    name: "舊系統黑白灰",
    theme: preset({
      primary: "#2c2c2c", bg: "#f8f8f9", ink: "#222222", inkSoft: "#666666",
      border: "#e0e0e3", tabs: "#ececef", btn2: "#f0f0f2", btn2Ink: "#555555",
    }),
  },
  {
    name: "櫻花粉",
    theme: preset({
      primary: "#c06c82", bg: "#fdf2f5", ink: "#5d4037", inkSoft: "#8d7671",
      border: "#e6d0d6", tabs: "#f6e4e9", btn2: "#f9ecef", btn2Ink: "#8d5a67",
    }),
  },
  {
    name: "奶茶",
    theme: preset({
      primary: "#96745a", bg: "#f6f0e8", ink: "#3b2a1e", inkSoft: "#7a6250",
      border: "#e2d4c4", tabs: "#ece2d6", btn2: "#f1e9df", btn2Ink: "#6f5643",
    }),
  },
  {
    name: "淡粉藍",
    theme: preset({
      primary: "#4a6fa5", bg: "#f5f8fd", ink: "#1f2a3a", inkSoft: "#5a6a80",
      border: "#d6e0ee", tabs: "#e6edf7", btn2: "#edf2f9", btn2Ink: "#4a5d78",
    }),
  },
  {
    name: "墨綠",
    theme: preset({
      primary: "#3f7355", bg: "#f5f9f6", ink: "#1c2b22", inkSoft: "#566b5d",
      border: "#d3e2d8", tabs: "#e4eee7", btn2: "#ebf3ee", btn2Ink: "#4b6455",
    }),
  },
];
