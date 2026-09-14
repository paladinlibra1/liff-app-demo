-- ╔══════════════════════════════════════════════════════════╗
-- ║  權限管理：名單的查詢與增刪                                ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- store_admins 只存 user_id，但畫面上要顯示信箱才有意義。
-- 信箱在 auth.users，那張表**不能**開放給一般登入者查——否則任何店員
-- 都能撈出這個 Supabase 專案裡所有人的信箱。
--
-- 所以走 SECURITY DEFINER 函式：函式內部自己檢查呼叫者的權限，
-- 只回傳「這家店的管理員」那幾列，其他一概查不到。
--
-- 每支都 set search_path = public：沒設的話呼叫端可以改 search_path，
-- 讓函式查到偽造的同名資料表。

-- ───────────────────────────────────────────────────────────
-- 查名單（店員也看得到，才知道店裡有誰）
-- ───────────────────────────────────────────────────────────
create or replace function public.list_store_admins(p_store_id uuid)
returns table (user_id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not is_store_admin(p_store_id) then
    raise exception '沒有權限查看這家店的名單' using errcode = '42501';
  end if;

  return query
    select sa.user_id, u.email::text, sa.role, sa.created_at
    from store_admins sa
    join auth.users u on u.id = sa.user_id
    where sa.store_id = p_store_id
    order by sa.role, sa.created_at;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 加人／改角色（只有負責人）
-- ───────────────────────────────────────────────────────────
-- 用信箱加人，不是用 user id——負責人手上只會有對方的信箱。
-- 對方必須先自己註冊過，這裡不代為建立帳號：密碼只能由本人設定。
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

  -- 把唯一的負責人降成店員，會讓這家店再也沒有人能管名單
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

  return v_user;
end;
$$;

-- ───────────────────────────────────────────────────────────
-- 移除（只有負責人）
-- ───────────────────────────────────────────────────────────
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
end;
$$;

-- 一般網路訪客不該碰得到這幾支
revoke execute on function public.list_store_admins(uuid) from public;
revoke execute on function public.add_store_admin(uuid, text, text) from public;
revoke execute on function public.remove_store_admin(uuid, uuid) from public;

grant execute on function public.list_store_admins(uuid) to authenticated;
grant execute on function public.add_store_admin(uuid, text, text) to authenticated;
grant execute on function public.remove_store_admin(uuid, uuid) to authenticated;
