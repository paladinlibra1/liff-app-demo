-- ╔══════════════════════════════════════════════════════════╗
-- ║  前一天提醒：開關與發送時間交給店家自己設                    ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 原本發送時間寫死在 wrangler.jsonc 的 cron 裡，要改得改程式碼再重新部署。
-- 改成：cron 每半小時觸發一次，Worker 讀這兩個欄位決定「這一輪要不要送」。
--
-- 為什麼只到半小時：cron 每 30 分鐘跑一次，設 20:15 的話最快也要等到
-- 20:30 才送得出去，介面上卻顯示 20:15，等於騙人。所以直接用 check
-- 限制成整點或半點，介面也只給這些選項。

alter table stores
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_time    time    not null default '20:00';

alter table stores
  add constraint stores_reminder_time_half_hour
  check (
    extract(minute from reminder_time) in (0, 30)
    and extract(second from reminder_time) = 0
  );

comment on column stores.reminder_enabled is '要不要在前一天發預約提醒';
comment on column stores.reminder_time    is '提醒的發送時間（店家時區，只能是整點或半點）';
