-- ╔══════════════════════════════════════════════════════════╗
-- ║  不再出現在待審核名單的人                                  ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 0018 的待審核名單是「已註冊、但不在 store_admins 裡」算出來的，
-- 所以負責人把某個人移除之後，那個人的帳號還在，下一秒又被算成待審核，
-- 變成移除了又跳回來等你通過——老闆回報的就是這個。
--
-- 這裡多一張「不要再問我」的表：被移除的、或被按了忽略的人記在這裡，
-- 待審核就跳過他們。重新通過時再把紀錄清掉。

create table store_denied_users (
  store_id   uuid not null references stores(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  denied_at  timestamptz not null default now(),
  primary key (store_id, user_id)
);

-- 開了 RLS 但故意不給任何政策：這張表只有底下的 security definer 函式碰得到，
-- 前端直接查會是空的。名單管理的權限判斷統一寫在函式裡，不散落在政策。
alter table store_denied_users enable row level security;

-- ───────────────────────────────────────────────────────────
-- 待審核：跳過被擋掉的人
-- ───────────────────────────────────────────────────────────
create or replace function public.list_pending_users(p_store_id uuid)
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以看待審核名單' using errcode = '42501';
  end if;

  return query
    select u.id, u.email::text, u.created_at
    from auth.users u
    where not exists (
      select 1 from store_admins sa
      where sa.store_id = p_store_id and sa.user_id = u.id
    )
      and not exists (
        select 1 from store_denied_users d
        where d.store_id = p_store_id and d.user_id = u.id
      )
      and u.email is not null
    order by u.created_at desc
    limit 50;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 已忽略的名單（要看得到才收得回來）
-- ───────────────────────────────────────────────────────────
create or replace function public.list_denied_users(p_store_id uuid)
returns table (user_id uuid, email text, denied_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以看這份名單' using errcode = '42501';
  end if;

  return query
    select d.user_id, u.email::text, d.denied_at
    from store_denied_users d
    join auth.users u on u.id = d.user_id
    where d.store_id = p_store_id
    order by d.denied_at desc;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 忽略／收回
-- ───────────────────────────────────────────────────────────
create or replace function public.deny_store_user(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以管理名單' using errcode = '42501';
  end if;

  insert into store_denied_users (store_id, user_id)
  values (p_store_id, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.undeny_store_user(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以管理名單' using errcode = '42501';
  end if;

  delete from store_denied_users
  where store_id = p_store_id and user_id = p_user_id;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 移除＝順手記成「不要再問我」
-- ───────────────────────────────────────────────────────────
-- 負責人把人移除，通常是「這個人不該有權限」，不是「請一分鐘後再問我一次」。
-- 其餘邏輯與 0007 相同。
create or replace function public.remove_store_admin(p_store_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_owners int;
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以管理名單' using errcode = '42501';
  end if;

  select role into v_role from store_admins
  where store_id = p_store_id and user_id = p_user_id;

  if v_role is null then
    return;   -- 本來就不在名單裡，當作已完成
  end if;

  -- 移掉最後一位負責人 = 把自己鎖在門外，之後只能靠後端金鑰救回來
  if v_role = 'owner' then
    select count(*) into v_owners from store_admins
    where store_id = p_store_id and role = 'owner';
    if v_owners <= 1 then
      raise exception '不能移除最後一位負責人' using errcode = '23514';
    end if;
  end if;

  delete from store_admins where store_id = p_store_id and user_id = p_user_id;

  insert into store_denied_users (store_id, user_id)
  values (p_store_id, p_user_id)
  on conflict do nothing;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 通過＝把「不要再問我」清掉
-- ───────────────────────────────────────────────────────────
-- 不清的話，移除過的人之後要再加回來，會加得進名單卻還留著一筆擋著，
-- 下次再移除時看起來就像沒反應。其餘邏輯與 0007 相同。
create or replace function public.add_store_admin(
  p_store_id uuid,
  p_email    text,
  p_role     text default 'staff'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_old  text;
  v_owners int;
begin
  if not is_store_owner(p_store_id) then
    raise exception '只有負責人可以管理名單' using errcode = '42501';
  end if;

  if p_role not in ('owner', 'staff') then
    raise exception '角色只能是 owner 或 staff' using errcode = '23514';
  end if;

  select id into v_user
  from auth.users
  where lower(email) = lower(trim(p_email));

  if v_user is null then
    raise exception '找不到這個信箱的帳號，請對方先自己註冊一次' using errcode = 'P0002';
  end if;

  select role into v_old from store_admins
  where store_id = p_store_id and user_id = v_user;

  if v_old = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners from store_admins
    where store_id = p_store_id and role = 'owner';
    if v_owners <= 1 then
      raise exception '不能把最後一位負責人改成店員' using errcode = '23514';
    end if;
  end if;

  insert into store_admins (store_id, user_id, role)
  values (p_store_id, v_user, p_role)
  on conflict (store_id, user_id) do update set role = excluded.role;

  delete from store_denied_users
  where store_id = p_store_id and user_id = v_user;

  return v_user;
end;
$$;

revoke execute on function public.list_denied_users(uuid) from public;
revoke execute on function public.deny_store_user(uuid, uuid) from public;
revoke execute on function public.undeny_store_user(uuid, uuid) from public;
grant  execute on function public.list_denied_users(uuid) to authenticated;
grant  execute on function public.deny_store_user(uuid, uuid) to authenticated;
grant  execute on function public.undeny_store_user(uuid, uuid) to authenticated;
