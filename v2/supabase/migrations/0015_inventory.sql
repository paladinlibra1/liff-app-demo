-- ╔══════════════════════════════════════════════════════════╗
-- ║  庫存盤點                                                  ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 搬自舊系統 inventory.html（Firestore 的 inventoryItems / inventoryBatches /
-- inventoryStocktakes / inventorySettings）。舊版是獨立頁面、用連結跳過去，
-- 這裡直接做成後台的一個分頁。
--
-- 資料模型照舊：一個商品有多個「批次」，每批有自己的效期與數量——
-- 保養品每批效期不同，只記總數就看不出哪一批快過期。
--
-- 只有後台店員會碰這些表，客人端完全不經過，所以只有 is_store_admin 的政策。

-- ───────────────────────────────────────────────────────────
-- 系列（舊版 inventorySettings/categoryOrder 的 order / careOrder）
-- ───────────────────────────────────────────────────────────
-- 產品與護理品各自一套系列。舊版是存成兩個字串陣列，
-- 這裡一列一個系列、sort_order 決定順序。
create table inventory_series (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  type        text not null check (type in ('產品', '護理品')),
  name        text not null check (name <> '' and name <> '未分類'),  -- 「未分類」是畫面上的保留字
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (store_id, type, name)
);

-- ───────────────────────────────────────────────────────────
-- 商品
-- ───────────────────────────────────────────────────────────
-- category 存系列名稱（不是 FK）：舊資料就是這樣，改名時由前端一起改掉底下的商品。
-- null 表示未分類。
create table inventory_items (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  code          text not null default '',       -- 例如 AB90
  name          text not null check (name <> ''),
  type          text not null check (type in ('產品', '護理品')),
  category      text,
  unit          text not null default '',
  member_price  integer not null default 0,
  pv            numeric(10, 2) not null default 0,   -- 1 PV = 135 元，還沒用到
  safety_stock  integer,                          -- null＝不提醒低庫存
  note          text not null default '',
  active        boolean not null default true,
  sort_order    integer,                          -- 系列內的手動順序，null 排在後面
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index inventory_items_store_idx on inventory_items (store_id, type);

create trigger inventory_items_touch before update on inventory_items
  for each row execute function touch_updated_at();

-- ───────────────────────────────────────────────────────────
-- 批次
-- ───────────────────────────────────────────────────────────
-- store_id 跟商品重複，是為了讓 RLS 不用 join 就能判斷。
create table inventory_batches (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  item_id      uuid not null references inventory_items(id) on delete cascade,
  expiry_date  date,
  qty          integer not null default 0 check (qty >= 0),
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index inventory_batches_item_idx on inventory_batches (item_id);
create index inventory_batches_store_idx on inventory_batches (store_id);

create trigger inventory_batches_touch before update on inventory_batches
  for each row execute function touch_updated_at();

-- ───────────────────────────────────────────────────────────
-- 盤點紀錄
-- ───────────────────────────────────────────────────────────
-- items 是送出當下的完整快照（每個批次一筆：帳面、實際、差異），
-- 商品之後改名或刪掉，歷史紀錄仍然看得懂。只保留最新 5 筆（老闆決定的）。
create table inventory_stocktakes (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  date        date not null,
  item_count  integer not null,
  total_diff  integer not null,
  items       jsonb not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index inventory_stocktakes_store_idx on inventory_stocktakes (store_id, created_at desc);

-- ───────────────────────────────────────────────────────────
-- RLS：同店店員全權
-- ───────────────────────────────────────────────────────────
alter table inventory_series     enable row level security;
alter table inventory_items      enable row level security;
alter table inventory_batches    enable row level security;
alter table inventory_stocktakes enable row level security;

create policy "店員管系列" on inventory_series
  for all to authenticated
  using (is_store_admin(store_id)) with check (is_store_admin(store_id));

create policy "店員管商品" on inventory_items
  for all to authenticated
  using (is_store_admin(store_id)) with check (is_store_admin(store_id));

create policy "店員管批次" on inventory_batches
  for all to authenticated
  using (is_store_admin(store_id)) with check (is_store_admin(store_id));

-- 盤點紀錄只能新增與讀取；刪除只在 submit_stocktake 裡清舊的
create policy "店員讀盤點紀錄" on inventory_stocktakes
  for select to authenticated
  using (is_store_admin(store_id));

-- ───────────────────────────────────────────────────────────
-- 送出盤點
-- ───────────────────────────────────────────────────────────
-- 舊版是「先寫庫存、再寫紀錄、再清舊紀錄」三個獨立請求，
-- 中間斷掉就會出現「庫存改了但沒有紀錄」，還得跳警告叫人別重送。
-- 這裡包成一個函式＝一個交易，要嘛全部成功、要嘛全部沒發生，
-- 按兩次也不會把新批次建兩次（第二次的 p_items 裡已經沒有 is_new 了——前端會重建草稿）。
--
-- p_items：每個批次一筆
--   { item_id, batch_id (新批次為 null), expiry_date, book_qty, actual_qty,
--     is_new (bool), removed (bool) }
--
-- security definer 才刪得到舊紀錄（上面沒開刪除政策），
-- 所以開頭自己檢查 is_store_admin，而且每一筆寫入都限定 store_id。
create or replace function public.submit_stocktake(
  p_store_id uuid,
  p_date     date,
  p_items    jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  it        jsonb;
  new_id    uuid;
  snapshot  jsonb := '[]'::jsonb;
  item_row  inventory_items%rowtype;
  diff      integer;
  total     integer := 0;
  result_id uuid;
begin
  if not is_store_admin(p_store_id) then
    raise exception '沒有這家店的權限';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '沒有商品可以盤點';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into item_row from inventory_items
      where id = (it->>'item_id')::uuid and store_id = p_store_id;
    if not found then
      raise exception '商品不存在或不屬於這家店：%', it->>'item_id';
    end if;

    new_id := nullif(it->>'batch_id', '')::uuid;
    diff   := coalesce((it->>'actual_qty')::int, 0) - coalesce((it->>'book_qty')::int, 0);

    if coalesce((it->>'removed')::boolean, false) then
      diff := -coalesce((it->>'book_qty')::int, 0);
      delete from inventory_batches where id = new_id and store_id = p_store_id;
    elsif coalesce((it->>'is_new')::boolean, false) then
      insert into inventory_batches (store_id, item_id, expiry_date, qty)
        values (p_store_id, item_row.id, nullif(it->>'expiry_date', '')::date,
                coalesce((it->>'actual_qty')::int, 0))
        returning id into new_id;
    elsif new_id is not null then
      -- 效期也可能在盤點時改過，數量沒變一樣要寫
      update inventory_batches
         set qty = coalesce((it->>'actual_qty')::int, 0),
             expiry_date = nullif(it->>'expiry_date', '')::date
       where id = new_id and store_id = p_store_id
         and (qty is distinct from coalesce((it->>'actual_qty')::int, 0)
              or expiry_date is distinct from nullif(it->>'expiry_date', '')::date);
    end if;

    total := total + diff;
    -- 快照裡的代碼與名稱由資料庫填，不信前端傳的
    snapshot := snapshot || jsonb_build_array(jsonb_build_object(
      'item_id',     item_row.id,
      'item_code',   item_row.code,
      'item_name',   item_row.name,
      'batch_id',    new_id,
      'expiry_date', nullif(it->>'expiry_date', ''),
      'book_qty',    coalesce((it->>'book_qty')::int, 0),
      'actual_qty',  case when coalesce((it->>'removed')::boolean, false) then 0
                          else coalesce((it->>'actual_qty')::int, 0) end,
      'diff',        diff,
      'is_new',      coalesce((it->>'is_new')::boolean, false),
      'removed',     coalesce((it->>'removed')::boolean, false)
    ));
  end loop;

  insert into inventory_stocktakes (store_id, date, item_count, total_diff, items, created_by)
    values (p_store_id, p_date, jsonb_array_length(p_items), total, snapshot, auth.uid())
    returning id into result_id;

  -- 只留最新 5 筆
  delete from inventory_stocktakes
   where store_id = p_store_id
     and id not in (
       select id from inventory_stocktakes
        where store_id = p_store_id
        order by created_at desc
        limit 5
     );

  return result_id;
end;
$$;

revoke execute on function public.submit_stocktake(uuid, date, jsonb) from public;
grant  execute on function public.submit_stocktake(uuid, date, jsonb) to authenticated;
