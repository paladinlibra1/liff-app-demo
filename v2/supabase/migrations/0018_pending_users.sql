-- ╔══════════════════════════════════════════════════════════╗
-- ║  待審核名單                                                ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 原本加人要負責人自己打對方的信箱（`add_store_admin`），意思是店員註冊完
-- 還得另外把信箱告訴老闆、老闆再一個字一個字打進去，打錯就說「找不到帳號」。
--
-- 這支讓「已經註冊、但還不在這家店名單裡」的人直接列在後台，按一下就通過。
--
-- auth.users 絕對不能開放給一般登入者查（那是整個專案所有人的信箱），
-- 所以走 SECURITY DEFINER，而且**只有負責人**呼叫得動——
-- 店員看得到同事名單是合理的，看得到所有註冊者不是。
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
      -- 沒有信箱的（例如只用手機或第三方登入建立的）沒辦法用信箱加入名單
      and u.email is not null
    -- 最近註冊的排前面，老闆要找的通常是剛剛那個人
    order by u.created_at desc
    limit 50;
end;
$$;

revoke execute on function public.list_pending_users(uuid) from public;
grant  execute on function public.list_pending_users(uuid) to authenticated;
