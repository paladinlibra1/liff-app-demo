import { splitStorePath } from "../shared/storeUrl";

/**
 * 前端這一頁是哪家店
 *
 * 網址第一段就是店名（`/madou/admin`）。開頁時算一次就好——
 * 我們沒有前端路由套件，換店是整頁重新載入。
 */
const here = splitStorePath(window.location.pathname);

/** 網址上的店名，沒帶就是 null（後端會落到預設店） */
export const STORE_SLUG = here.slug;

/** 去掉店名之後的路徑，前端的路由判斷要看這個 */
export const ROUTE_PATH = here.rest;

/**
 * API 網址一定要帶著店名，前端在哪家店、後端就回哪家店的資料。
 * 少了這個，麻豆店的畫面會拿到潮州店的資料——而且不會報錯。
 */
export function apiUrl(path: string): string {
  return STORE_SLUG ? `/${STORE_SLUG}${path}` : path;
}

/** 同一家店底下的另一個頁面（例如從預約頁跳到「我的預約」） */
export function pageUrl(path: string): string {
  return apiUrl(path);
}
