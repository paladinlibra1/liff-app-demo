-- ╔══════════════════════════════════════════════════════════╗
-- ║  美學預約系統 v2 — 初始 schema                             ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 對照舊版 Firestore 的三個大改動（理由寫在各段落上方）：
--   1. bookings / historicalBookings / cancelledBookings → 合併成一張 bookings
--   2. 「同一天只能預約一次」「時段人數上限」→ 從前端 transaction 改成資料庫層約束
--   3. 所有表都帶 store_id，多店從第一天就成立

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────
-- 店家（租戶）
-- ───────────────────────────────────────────────────────────
create table stores (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,          -- 網址用，例如 "colorfashion"
  name        text not null,
  timezone    text not null default 'Asia/Taipei',
  -- 營業時段（沿用舊版 STORE_CONFIG.times 的形狀）
  -- { "weekday": ["12:30",...], "saturday": [...] }
  business_hours jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- 後台管理員白名單（取代舊版 Firestore settings/admins 那份世界可寫的文件）
create table store_admins (
  store_id   uuid not null references stores(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

-- ───────────────────────────────────────────────────────────
-- 會員
-- ───────────────────────────────────────────────────────────
-- 舊版 doc id 同時是 lineId，手動建的會員則是 "manual_xxx"，
-- 兩種身分混在同一個欄位。這裡拆開：id 是主鍵，line_user_id 可為 null。
create table members (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,

  line_user_id   text,                       -- 沒綁 LINE 的手動會員為 null
  line_name      text,

  name           text not null,
  phone          text not null,              -- 存正規化後的格式
  birthday       date,
  referrer       text,
  note           text,

  -- 未成年會員綁監護人：通知改發給監護人的 LINE（舊版 guardianLineId）
  guardian_id    uuid references members(id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- LINE userId 是 per-provider 的，同一店內才保證唯一
create unique index members_store_line_uniq
  on members (store_id, line_user_id) where line_user_id is not null;

create index members_store_phone_idx on members (store_id, phone);
create index members_store_name_idx  on members (store_id, name);

-- ───────────────────────────────────────────────────────────
-- 營業日
-- ───────────────────────────────────────────────────────────
-- 舊版 doc id 是日期字串，只有 { isOperating: true } 跟 blockedTimes。
create table operating_days (
  store_id      uuid not null references stores(id) on delete cascade,
  date          date not null,
  is_operating  boolean not null default true,
  blocked_times text[] not null default '{}',   -- 例如 {'14:00','14:30'}
  primary key (store_id, date)
);

-- ───────────────────────────────────────────────────────────
-- 預約
-- ───────────────────────────────────────────────────────────
-- 舊版拆成 bookings / historicalBookings / cancelledBookings 三個 collection，
-- 報表要全部掃一遍才能合併。這裡合成一張表 + status 欄位，
-- 「封存」變成改狀態而不是搬資料（archiveOldBookings 那段刪資料的風險就沒了）。
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,

  member_id   uuid references members(id) on delete set null,
  -- 通知要發給誰的 LINE（監護人情境下不等於 member 本人），下單當下解析好存起來
  notify_line_user_id text,

  -- 下單當下的快照：客人事後改名改電話，不該動到歷史單
  name        text not null,
  name2       text,                           -- 同行第二人，null 表示只有一位
  phone       text not null,

  type        text not null,                  -- 新客體驗 / 一般預約 / 複檢 ...
  date        date not null,
  start_time  time not null,
  remark      text,

  status      text not null default 'active'
              check (status in ('active','completed','cancelled')),
  booked_by   text not null default 'customer'
              check (booked_by in ('customer','admin')),   -- 舊版的 role

  -- 佔幾個位子：一位或兩位。用 generated column 讓上限檢查有東西可加總
  seats       smallint not null generated always as
              (case when name2 is null or name2 = '' then 1 else 2 end) stored,

  reminded_at   timestamptz,                  -- 舊版 isReminded
  cancelled_at  timestamptz,
  cancel_reason text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 報表與日曆都是「某段日期區間」的查詢，這個索引是效能關鍵
create index bookings_store_date_idx on bookings (store_id, date);
create index bookings_store_status_date_idx on bookings (store_id, status, date);
create index bookings_member_idx on bookings (member_id);

-- 規則 1：同一位會員同一天只能有一筆有效預約
-- 舊版是在前端 transaction 裡撈整天的單再比對，現在交給資料庫，
-- 兩個人同時按送出也不可能同時成立。
create unique index bookings_one_per_member_per_day
  on bookings (store_id, date, member_id)
  where status = 'active' and member_id is not null;

-- ───────────────────────────────────────────────────────────
-- 規則 2：同一時段最多 2 個位子
-- ───────────────────────────────────────────────────────────
-- 沒辦法用 unique index 表達（要加總），所以用 trigger。
-- 先鎖住同店同日同時段的既有列，避免兩個並行交易各自算出「還有位子」。
create or replace function check_slot_capacity() returns trigger as $$
declare
  used smallint;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- 先用 advisory lock 把「同店 + 同日 + 同時段」這個格子鎖起來。
  -- 不能用 SELECT sum(...) FOR UPDATE（Postgres 不允許對聚合加鎖），
  -- 而沒有鎖的話兩個並行交易會各自算出「還有位子」而雙雙成立。
  perform pg_advisory_xact_lock(
    hashtextextended(new.store_id::text || new.date::text || new.start_time::text, 0)
  );

  select coalesce(sum(seats), 0) into used
  from bookings
  where store_id   = new.store_id
    and date       = new.date
    and start_time = new.start_time
    and status     = 'active'
    and id <> new.id;

  if used + new.seats > 2 then
    raise exception 'slot_full' using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

create trigger bookings_slot_capacity
  before insert or update on bookings
  for each row execute function check_slot_capacity();

-- ───────────────────────────────────────────────────────────
-- updated_at 自動更新
-- ───────────────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger members_touch  before update on members
  for each row execute function touch_updated_at();
create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();
