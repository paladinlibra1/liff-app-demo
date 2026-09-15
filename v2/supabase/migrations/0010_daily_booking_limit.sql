-- ╔══════════════════════════════════════════════════════════╗
-- ║  同一個 LINE 一天最多兩筆                                  ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 客人可以幫別人訂之後，「同一位會員同一天一筆」那條唯一索引就管不到了：
-- 代訂的單沒有 member_id，一個人可以無限往同一天塞。
--
-- 所以另外記「這筆是誰送出來的」，用它來限制。跟 member_id 不一樣：
--   member_id            = 這筆是「誰的」預約（代訂時是空的）
--   booker_line_user_id  = 這筆是「誰送出來的」（代訂時仍然是下單的人）
--
-- 店家代客預約不受限制：那一支是後台建的，booker 留空。

alter table bookings
  add column if not exists booker_line_user_id text;

comment on column bookings.booker_line_user_id is
  '送出這筆預約的 LINE 使用者；後台代客預約為 null（不受每日上限限制）';

-- 上限檢查每次寫入都要查一次，這個索引是它的效能來源
create index if not exists bookings_booker_day_idx
  on bookings (store_id, date, booker_line_user_id)
  where status = 'active';

-- ───────────────────────────────────────────────────────────
-- 一天兩筆的把關
-- ───────────────────────────────────────────────────────────
-- 跟時段上限同一個做法：前端先查一次是為了講人話，這裡才是真的擋得住的那層。
-- 兩個分頁同時按送出、或連點兩下，只有資料庫算得準。
--
-- SECURITY DEFINER：bookings 有 RLS，不加的話這句 count 會被呼叫端的政策
-- 過濾成「他看得到的那些」，客人看不到別人的單 → 永遠算成 0 → 形同虛設。
create or replace function check_daily_booking_limit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
begin
  if new.status <> 'active' or new.booker_line_user_id is null then
    return new;
  end if;

  -- 先鎖住「這個人這一天」，避免兩個並行交易各自算出「還可以再訂一筆」。
  -- 第二個參數跟 check_slot_capacity() 用不同的值，免得兩種鎖互相卡到。
  perform pg_advisory_xact_lock(
    hashtextextended(new.store_id::text || new.date::text || new.booker_line_user_id, 1)
  );

  select count(*) into used
  from bookings
  where store_id            = new.store_id
    and date                = new.date
    and booker_line_user_id = new.booker_line_user_id
    and status              = 'active'
    and id <> new.id;

  if used >= 2 then
    raise exception 'daily_limit' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_daily_limit on bookings;
create trigger bookings_daily_limit
  before insert or update on bookings
  for each row execute function check_daily_booking_limit();
