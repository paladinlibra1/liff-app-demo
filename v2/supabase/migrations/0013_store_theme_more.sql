-- ╔══════════════════════════════════════════════════════════╗
-- ║  後台配色：多開放文字、卡片邊框、分頁列與次要按鈕            ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 0012 只開放主色與底色。老闆要能調更多，這次加七個。
-- 仍然不是全部開放：最淡的提示字、細分隔線、按壓色這些
-- 由下面的值推算（src/admin/theme.ts），各自獨立只會調出不協調的組合。
--
-- 跟 0012 一樣，null 表示「用程式裡的預設」。

alter table stores
  add column if not exists theme_ink      text,   -- 主要文字
  add column if not exists theme_ink_soft text,   -- 次要文字（說明、標籤）
  add column if not exists theme_card     text,   -- 卡片底
  add column if not exists theme_border   text,   -- 卡片、輸入框的邊框
  add column if not exists theme_tabs     text,   -- 分頁列底槽
  add column if not exists theme_btn2     text,   -- 次要按鈕底（編輯、今天／未來 7 天…）
  add column if not exists theme_btn2_ink text;   -- 次要按鈕字

alter table stores
  add constraint stores_theme_more_hex
  check (
    (theme_ink      is null or theme_ink      ~ '^#[0-9a-fA-F]{6}$')
    and (theme_ink_soft is null or theme_ink_soft ~ '^#[0-9a-fA-F]{6}$')
    and (theme_card     is null or theme_card     ~ '^#[0-9a-fA-F]{6}$')
    and (theme_border   is null or theme_border   ~ '^#[0-9a-fA-F]{6}$')
    and (theme_tabs     is null or theme_tabs     ~ '^#[0-9a-fA-F]{6}$')
    and (theme_btn2     is null or theme_btn2     ~ '^#[0-9a-fA-F]{6}$')
    and (theme_btn2_ink is null or theme_btn2_ink ~ '^#[0-9a-fA-F]{6}$')
  );

comment on column stores.theme_ink      is '後台主要文字色，#rrggbb；null 用預設';
comment on column stores.theme_ink_soft is '後台次要文字色，#rrggbb；null 用預設';
comment on column stores.theme_card     is '後台卡片底色，#rrggbb；null 用預設';
comment on column stores.theme_border   is '後台邊框色，#rrggbb；null 用預設';
comment on column stores.theme_tabs     is '後台分頁列底色，#rrggbb；null 用預設';
comment on column stores.theme_btn2     is '後台次要按鈕底色，#rrggbb；null 用預設';
comment on column stores.theme_btn2_ink is '後台次要按鈕文字色，#rrggbb；null 用預設';
