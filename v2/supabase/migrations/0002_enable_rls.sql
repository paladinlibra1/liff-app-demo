-- ╔══════════════════════════════════════════════════════════╗
-- ║  啟用 RLS —— 預設全部拒絕                                  ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- Supabase 的 public schema 新表預設對 anon / authenticated 角色開放，
-- 也就是拿到 anon key 就能讀寫全部資料（跟舊系統 Firestore 規則全開同一個問題）。
--
-- 這份 migration 只做一件事：把 RLS 打開。
-- 打開但「不給任何政策」= 預設拒絕所有存取，之後再一條一條開放。
--
-- 注意：service_role 會繞過 RLS（它有 BYPASSRLS），
--       所以 Cloudflare Worker 用 service_role key 仍然能正常讀寫。
--       這也是為什麼 service_role key 絕對不能出現在前端。
--
-- 沒有用 FORCE ROW LEVEL SECURITY —— 那會連表的擁有者（postgres）都套用，
-- 會擋掉之後的 migration 和 CLI 操作。

alter table stores          enable row level security;
alter table store_admins    enable row level security;
alter table members         enable row level security;
alter table operating_days  enable row level security;
alter table bookings        enable row level security;
