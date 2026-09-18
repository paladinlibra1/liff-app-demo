-- ╔══════════════════════════════════════════════════════════╗
-- ║  沉睡客關懷紀錄                                            ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 搬自舊系統 admin.html 的沉睡客名單（Firestore reportFollowUps）。
--
-- 名單本身是算出來的（最近一次到店超過 90 天），不需要存；
-- 要存的只有「人為」的那兩件事：
--   1. 什麼時候發過關懷訊息 → 冷卻期內先不要再出現，免得同一位客人被連續轟炸
--   2. 這個人不要再出現在名單上（搬家了、已經明講不想被打擾）
--
-- 一位客人一列。認人用 member_id：舊系統只能用電話當 key，
-- 電話打錯一個字就會變成另一個人；v2 的會員有 id，直接綁 id。

create table member_followups (
  member_id     uuid primary key references members(id) on delete cascade,
  store_id      uuid not null references stores(id) on delete cascade,
  last_sent_at  timestamptz,
  /** 累計發過幾次，看得出是不是一直在騷擾同一位客人 */
  sent_count    integer not null default 0,
  excluded      boolean not null default false,
  note          text not null default '',
  updated_at    timestamptz not null default now()
);
create index member_followups_store_idx on member_followups (store_id);

create trigger member_followups_touch before update on member_followups
  for each row execute function touch_updated_at();

-- ───────────────────────────────────────────────────────────
-- RLS：同店店員全權（客人端完全不碰這張表）
-- ───────────────────────────────────────────────────────────
alter table member_followups enable row level security;

create policy "店員管關懷紀錄" on member_followups
  for all to authenticated
  using (is_store_admin(store_id)) with check (is_store_admin(store_id));

-- ───────────────────────────────────────────────────────────
-- 關懷訊息範本
-- ───────────────────────────────────────────────────────────
-- 每家店自己一份，可以在後台改。{{name}} 會被換成客人姓名。
alter table stores add column if not exists dormant_message text not null default
  '{{name}} 您好 😊 好久不見，最近肌膚狀況還好嗎？我們準備了專屬的回饋方案，隨時歡迎預約，期待再見到您！';

-- ───────────────────────────────────────────────────────────
-- 記一次發送
-- ───────────────────────────────────────────────────────────
-- upsert 沒辦法「在原值上加一」（PostgREST 會整列蓋掉，次數永遠停在 1），
-- 所以包成函式。Worker 用 service key 呼叫，前端不會用到，
-- 但函式自己仍然限定 store_id，不讓別家店的 member_id 混進來。
create or replace function public.record_followup(
  p_member_id uuid,
  p_store_id  uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from members where id = p_member_id and store_id = p_store_id
  ) then
    raise exception '這位會員不屬於這家店';
  end if;

  insert into member_followups (member_id, store_id, last_sent_at, sent_count)
    values (p_member_id, p_store_id, now(), 1)
  on conflict (member_id) do update
    set last_sent_at = now(),
        sent_count   = member_followups.sent_count + 1;
end;
$$;

revoke execute on function public.record_followup(uuid, uuid) from public;
