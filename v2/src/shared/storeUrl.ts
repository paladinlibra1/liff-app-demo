/**
 * 網址帶店名
 *
 * `/chaozhou/admin`、`/madou/my`……第一段是店名（slug），後面才是原本的路由。
 * 一份程式碼服務多家店，各店有自己的網址，不是同一個網址靠後台切換店家。
 *
 * **沒有店名的網址仍然有效**，會落到 Worker 的 `STORE_SLUG`（潮州店）。
 * 這件事不能省：潮州店的 LIFF endpoint 與推播卡片上的連結都指著現在的網址，
 * 一改路由那些全部要重設，客人手上的舊連結也會壞掉。
 *
 * Worker 與前端共用這一支，兩邊的判斷不能有出入——不然會出現
 * 「前端以為在麻豆店、API 卻回潮州店的資料」這種最難查的錯。
 */

/** 這些是應用程式自己的路由或靜態資源，不可能是店名 */
const APP_ROUTES = new Set(["api", "admin", "my", "register", "assets"]);

/** 店名只收小寫英數與連字號，長度 2–31（跟 Supabase 的 slug 一致） */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;

export interface StorePath {
  /** 網址上的店名，沒帶就是 null（代表用預設店） */
  slug: string | null;
  /** 去掉店名之後的路徑，開頭一定有 `/` */
  rest: string;
}

export function splitStorePath(pathname: string): StorePath {
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0];

  if (first && !APP_ROUTES.has(first) && SLUG.test(first)) {
    return { slug: first, rest: "/" + parts.slice(1).join("/") };
  }
  // `/favicon.ico`、`/manifest.json` 這種有點的檔名過不了 SLUG，會走這裡
  return { slug: null, rest: pathname };
}
