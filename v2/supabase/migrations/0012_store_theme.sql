-- ╔══════════════════════════════════════════════════════════╗
-- ║  後台配色                                                  ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 原本每次要換顏色都得改 styles.css 再重新部署。改成存在店家設定裡，
-- 老闆自己在後台調、存完就生效。
--
-- 只開放兩個顏色：主色（按鈕與強調）與頁面底色。
-- 其餘（邊框、陰影、文字）由這兩個推算或沿用預設——全部開放的話會調出
-- 看不清楚的組合，而且那些值之間本來就有關聯，不該各自獨立設定。
--
-- null 表示「用程式裡的預設」，不是「沒顏色」。

alter table stores
  add column if not exists theme_primary text,
  add column if not exists theme_bg      text;

-- 只收 #rrggbb。少了這個，前端一個打錯的值會讓整頁樣式壞掉
alter table stores
  add constraint stores_theme_hex
  check (
    (theme_primary is null or theme_primary ~ '^#[0-9a-fA-F]{6}$')
    and (theme_bg is null or theme_bg ~ '^#[0-9a-fA-F]{6}$')
  );

comment on column stores.theme_primary is '後台主色（按鈕、強調），#rrggbb；null 用預設';
comment on column stores.theme_bg      is '後台頁面底色，#rrggbb；null 用預設';
