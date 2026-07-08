/**
 * ╔══════════════════════════════════════════════╗
 * ║         店家設定檔 - 每家店只改這個           ║
 * ╚══════════════════════════════════════════════╝
 */
const STORE_CONFIG = {

  // ── Firebase 設定 ──────────────────────────────
  firebase: {
    apiKey: "AIzaSyAgCfJ7CSme4K4MR8Xb0Cjwt6Cuzu6JUVU",
    authDomain: "colorfashion-booking.firebaseapp.com",
    projectId: "colorfashion-booking",
    storageBucket: "colorfashion-booking.firebasestorage.app",
    messagingSenderId: "658886755238",
    appId: "1:658886755238:web:904c4a27bcc10b3b5f0567"
  },

  // ── LINE LIFF ID ───────────────────────────────
  liffId: {
    booking:    "2009018559-AeGOURPY",   // index.html
    myBookings: "2009018559-Bbz87reV"    // my-bookings.html
  },

  // ── GAS Webhook URL ────────────────────────────
  gasUrl: "https://script.google.com/macros/s/AKfycbzpxsB2MFz5_3O-PH763lkOXDsBVhqXNMYm9cZVciP3Gba4N_DirAgPLyg1Aphmqf_b/exec",

  // ── 店家資訊 ───────────────────────────────────
  storeName: "Color Fashion",

  // ── 營業時間 ───────────────────────────────────
  times: {
    weekday:  ["12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"],
    saturday: ["10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30"]
  }

};
