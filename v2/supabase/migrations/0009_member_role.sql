-- ╔══════════════════════════════════════════════════════════╗
-- ║  會員身分（舊系統 members 的 role 欄位）                    ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 舊系統靠這個欄位把「不是真客人」的人從報表裡排除：
-- 店家自己、助理、夥伴都會建會員資料、也會有預約紀錄，
-- 但那些不該被算進客數與業績。
--
-- null（空白）＝ 一般客人，是絕大多數，所以不給預設值也不設 not null。

alter table members
  add column if not exists role text;

alter table members
  add constraint members_role_allowed
  check (role is null or role in ('店家', '助理', '夥伴'));

comment on column members.role is '會員身分：null 表示一般客人，其餘為店家／助理／夥伴（不列入報表）';
