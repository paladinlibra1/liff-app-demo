/**
 * 後台配色
 *
 * 預設值寫在 styles.css 的 `body.admin-theme`。店家在設定分頁選了顏色之後，
 * 這裡把它們蓋到 body 的 inline style 上——inline 的優先度高於樣式表，
 * 所以不必動 CSS，也不用重新部署。
 *
 * 只開放主色與底色兩個。其餘（按壓色、輸入框底、陰影）由它們推算：
 * 那些值本來就跟主色綁在一起，各自獨立設定只會調出不協調的組合。
 */

export interface Theme {
  /** 按鈕與強調色 `#rrggbb` */
  primary: string;
  /** 頁面底色 `#rrggbb` */
  bg: string;
}

/** styles.css 裡 body.admin-theme 的預設值，兩邊要一致 */
export const DEFAULT_THEME: Theme = { primary: "#c2585a", bg: "#fafafa" };

export const HEX = /^#[0-9a-fA-F]{6}$/;

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
 * 跟白色的對比。按鈕是白字，低於 4.5 就讀不清楚。
 *
 * 不擋住存檔——顏色是店家的選擇，我們只負責告訴他會看不清楚。
 */
export function contrastWithWhite(hex: string): number {
  const l = luminance(hex);
  return 1.05 / (l + 0.05);
}

/**
 * 套用配色。
 *
 * 掛在 body 而不是某個容器：token 定義在 body.admin-theme 上，
 * 蓋在同一個元素才蓋得過去。
 */
export function applyTheme(theme: Partial<Theme> | null): void {
  const body = document.body;
  const primary = theme?.primary && HEX.test(theme.primary) ? theme.primary : null;
  const bg = theme?.bg && HEX.test(theme.bg) ? theme.bg : null;

  if (primary) {
    body.style.setProperty("--rose", primary);
    body.style.setProperty("--rose-deep", darken(primary, 0.14));
  } else {
    body.style.removeProperty("--rose");
    body.style.removeProperty("--rose-deep");
  }

  if (bg) {
    body.style.setProperty("--rose-tint", bg);
    // 輸入框底比頁面底再亮一點，卡片是純白，三層才分得出來
    body.style.setProperty("--rose-wash", lighten(bg, 0.5));
    body.style.background = bg;
  } else {
    body.style.removeProperty("--rose-tint");
    body.style.removeProperty("--rose-wash");
    body.style.removeProperty("background");
  }
}

/** 幾組調好的，省得自己一個一個試 */
export const PRESETS: { name: string; theme: Theme }[] = [
  { name: "暖白（預設）", theme: { primary: "#c2585a", bg: "#fafafa" } },
  { name: "舊系統黑白灰", theme: { primary: "#2c2c2c", bg: "#f8f8f9" } },
  { name: "櫻花粉", theme: { primary: "#c06c82", bg: "#fdf2f5" } },
  { name: "奶茶", theme: { primary: "#96745a", bg: "#f6f0e8" } },
  { name: "淡粉藍", theme: { primary: "#4a6fa5", bg: "#f5f8fd" } },
  { name: "墨綠", theme: { primary: "#3f7355", bg: "#f5f9f6" } },
];
