-- ╔══════════════════════════════════════════════════════════╗
-- ║  後台店員的 RLS 政策                                       ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 後台店員直連 Supabase（原生 Auth），靠這些政策把關。
-- 客人端不走這裡——客人一律經過 Worker，Worker 用 service_role 繞過 RLS。

-- ───────────────────────────────────────────────────────────
-- 判斷函式
-- ───────────────────────────────────────────────────────────
-- ⚠️ 必須 SECURITY DEFINER。
--    store_admins 自己也開了 RLS，如果政策裡直接 select store_admins，
--    會觸發自己的政策 → 無限遞迴（Postgres 會直接報錯）。
--    SECURITY DEFINER 讓函式以擁有者身分執行、繞過 RLS，打破這個循環。
--
--    set search_path = public 是必要的防護：沒設的話，呼叫端可以改
--    search_path 讓函式查到偽造的同名資料表。

create or replace function public.is_store_admin(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from store_admins
    where store_id = p_store_id
      and user_id  = auth.uid()
  );
$$;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from store_admins
    where store_id = p_store_id
      and user_id  = auth.uid()
      and role     = 'owner'
  );
$$;

revoke execute on function public.is_store_admin(uuid) from public;
revoke execute on function public.is_store_owner(uuid) from public;
grant  execute on function public.is_store_admin(uuid) to authenticated;
grant  execute on function public.is_store_owner(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────
-- stores：店員讀得到自己的店，只有 owner 能改
-- ───────────────────────────────────────────────────────────
-- 沒有 insert 政策——開新店是 service_role 的事，不開放給任何登入者。
create policy "店員讀自己的店" on stores
  for select to authenticated
  using (is_store_admin(id));

create policy "owner 改自己的店" on stores
  for update to authenticated
  using (is_store_owner(id))
  with check (is_store_owner(id));

-- ───────────────────────────────────────────────────────────
-- store_admins：看得到同店同事，只有 owner 能增刪
-- ───────────────────────────────────────────────────────────
create policy "店員看同店名單" on store_admins
  for select to authenticated
  using (is_store_admin(store_id));

create policy "owner 加人" on store_admins
  for insert to authenticated
  with check (is_store_owner(store_id));

create policy "owner 改權限" on store_admins
  for update to authenticated
  using (is_store_owner(store_id))
  with check (is_store_owner(store_id));

create policy "owner 移除人" on store_admins
  for delete to authenticated
  using (is_store_owner(store_id));

-- ───────────────────────────────────────────────────────────
-- 營運資料：店員在自己的店內有完整權限
-- ───────────────────────────────────────────────────────────
create policy "店員管理會員" on members
  for all to authenticated
  using (is_store_admin(store_id))
  with check (is_store_admin(store_id));

create policy "店員管理營業日" on operating_days
  for all to authenticated
  using (is_store_admin(store_id))
  with check (is_store_admin(store_id));

create policy "店員管理預約" on bookings
  for all to authenticated
  using (is_store_admin(store_id))
  with check (is_store_admin(store_id));

-- ───────────────────────────────────────────────────────────
-- 補強 0001 的時段上限 trigger
-- ───────────────────────────────────────────────────────────
-- bookings 開了 RLS 之後，trigger 裡那句 select sum(seats) 會被呼叫端的
-- RLS 過濾——只算得到「這個使用者看得到的」預約。
--
-- 目前兩條路徑都還正確（店員看得到全店、service_role 繞過 RLS），
-- 但只要之後開放客人直接寫入，客人看不到別人的單 → 加總永遠是 0
-- → 時段上限形同虛設，而且是無聲的。
--
-- 改成 SECURITY DEFINER，讓它一律以擁有者身分看到全部資料。
create or replace function check_slot_capacity() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used smallint;
begin
  if new.status <> 'active' then
    return new;
  end if;

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
$$;
