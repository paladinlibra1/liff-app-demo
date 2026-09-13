-- ╔══════════════════════════════════════════════════════════╗
-- ║  修正：時段上限檢查從來沒有生效                             ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 0001 的 trigger 用 new.seats 來加總，但 seats 是 STORED GENERATED 欄位，
-- Postgres 要等 BEFORE 觸發器全部跑完才計算它。
-- 也就是在 trigger 裡 new.seats 永遠是 NULL：
--
--     used + NULL  →  NULL
--     NULL > 2     →  NULL（不是 true）
--     → if 不成立 → 不丟例外 → 無聲放行
--
-- 實測：同一時段連續塞 3 個人全部成功（應該第 3 個被擋）。
--
-- 修法：在 trigger 裡自己算這筆佔幾個位子，不要讀 new.seats。
-- （既有資料列的 seats 已經算好了，sum(seats) 那段沒問題。）

create or replace function check_slot_capacity() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used        smallint;
  incoming    smallint;
  slot_limit  constant smallint := 2;
begin
  if new.status <> 'active' then
    return new;
  end if;

  -- 自己算，不能用 new.seats（此時尚未生成）
  incoming := case
                when new.name2 is null or btrim(new.name2) = '' then 1
                else 2
              end;

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

  if used + incoming > slot_limit then
    raise exception 'slot_full: 該時段僅剩 % 個位子，這筆需要 %',
      slot_limit - used, incoming
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
