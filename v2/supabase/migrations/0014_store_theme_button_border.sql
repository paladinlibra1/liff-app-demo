-- ╔══════════════════════════════════════════════════════════╗
-- ║  後台配色：主要／次要按鈕的邊框                              ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- null 的意思跟其他配色欄位不一樣：不是「用固定的預設色」，
-- 而是「跟那顆按鈕的底色一樣」（看起來就是沒有框）。
-- 這樣換主色時邊框會一起換，不會留下一圈舊顏色。

alter table stores
  add column if not exists theme_btn_border  text,   -- 主要按鈕邊框
  add column if not exists theme_btn2_border text;   -- 次要按鈕邊框

alter table stores
  add constraint stores_theme_button_border_hex
  check (
    (theme_btn_border is null or theme_btn_border ~ '^#[0-9a-fA-F]{6}$')
    and (theme_btn2_border is null or theme_btn2_border ~ '^#[0-9a-fA-F]{6}$')
  );

comment on column stores.theme_btn_border  is '後台主要按鈕邊框，#rrggbb；null 表示跟主色相同';
comment on column stores.theme_btn2_border is '後台次要按鈕邊框，#rrggbb；null 表示跟次要按鈕底色相同';
