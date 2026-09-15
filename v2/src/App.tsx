import { lazy, Suspense } from "react";

/**
 * 一個網址服務三套畫面：
 *   /            → 客人端預約頁（LIFF）
 *   /my          → 客人的預約紀錄與取消（另一個 LIFF）
 *   /my/register → 會員綁定（跟「我的預約」共用同一個 LIFF）
 *   /admin       → 後台（店員用瀏覽器開）
 *
 * 客人端這兩頁分成兩個網址，是因為 LINE 的 LIFF 一個應用程式只能指一個
 * 網址——舊系統也是 index.html 與 my-bookings.html 兩個 LIFF，這裡照舊。
 *
 * 沒有用路由套件：三個入口用 `pathname` 判斷就夠了，多一個相依套件不划算。
 *
 * 三邊都 lazy 載入，各自分開打包：客人在手機上開預約頁，
 * 不該順便下載一份他們永遠用不到的後台。
 */
const AdminApp = lazy(() => import("./admin/AdminApp"));
const BookingApp = lazy(() => import("./customer/BookingApp"));
const MyBookingsApp = lazy(() => import("./customer/MyBookingsApp"));
const RegisterApp = lazy(() => import("./customer/RegisterApp"));

function pick() {
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return <AdminApp />;
  /*
   * 綁定頁要排在 /my 前面。
   *
   * LIFF 的網址後面可以接路徑，接了之後開的是「端點網址 + 那段路徑」，
   * 而我的預約的端點是 /my，所以從 LINE 進來的綁定頁會是 /my/register。
   * 兩種寫法都收，直接開 /register 在瀏覽器裡測畫面也通。
   */
  if (path.startsWith("/my/register") || path.startsWith("/register")) {
    return <RegisterApp />;
  }
  if (path.startsWith("/my")) return <MyBookingsApp />;
  return <BookingApp />;
}

export default function App() {
  return (
    <Suspense fallback={<div className="center-screen"><p className="sub">載入中…</p></div>}>
      {pick()}
    </Suspense>
  );
}
