import { lazy, Suspense } from "react";

/**
 * 一個網址服務兩套畫面：
 *   /        → 客人端預約頁（從 LINE 的 LIFF 開啟）
 *   /admin   → 後台（店員用瀏覽器開）
 *
 * 沒有用路由套件——只有兩個入口，`pathname` 判斷就夠了，
 * 多一個相依套件不划算。之後真的需要多層路由再說。
 *
 * 後台用 lazy 載入：客人端在手機上開，不該為了一個他們永遠用不到的
 * 後台多下載一份程式。
 */
const AdminApp = lazy(() => import("./admin/AdminApp"));
const BookingApp = lazy(() => import("./customer/BookingApp"));

export default function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");

  return (
    <Suspense fallback={<div className="center-screen"><p className="sub">載入中…</p></div>}>
      {isAdmin ? <AdminApp /> : <BookingApp />}
    </Suspense>
  );
}
