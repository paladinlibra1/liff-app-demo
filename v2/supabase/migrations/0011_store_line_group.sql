-- ╔══════════════════════════════════════════════════════════╗
-- ║  店家的 LINE 群組                                          ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 有人訂位時要通知店裡的群組，但群組 ID 只有在「官方帳號被加進群組」的
-- webhook 事件裡拿得到——LINE 沒有任何介面可以查。
--
-- 原本的做法是把它設成 Worker secret，那代表老闆要先把 ID 傳給我、
-- 我再手動設定一次。改成存在資料庫：webhook 收到 join 事件就自己寫進來，
-- 被踢出群組時清掉，中間不需要任何人做事。

alter table stores
  add column if not exists line_group_id text;

comment on column stores.line_group_id is
  '店家群組的 LINE groupId；由 webhook 的 join 事件自動寫入，leave 時清空';
