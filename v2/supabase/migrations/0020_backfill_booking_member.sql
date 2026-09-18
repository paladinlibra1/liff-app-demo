-- ╔══════════════════════════════════════════════════════════╗
-- ║  把過去沒接上會員的預約接回去                              ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 後台代客預約時「會員」欄位是可不選的，沒選就 member_id = null，
-- 那筆單跟客人的 LINE 毫無關聯——客人在「我的預約」看不到自己的單。
-- Worker 已經改成沒挑會員時自己用電話對一次，但已經建好的單要補。
--
-- 只補「剛好一位會員用這支電話」的：兩位以上代表號碼重複（家人共用），
-- 猜錯會把別人的單掛到這個人名下，寧可不補。

update bookings b
   set member_id = m.id
  from members m
 where b.member_id is null
   and m.store_id = b.store_id
   and m.phone = b.phone
   and b.phone <> ''
   and (
     select count(*) from members m2
      where m2.store_id = b.store_id and m2.phone = b.phone
   ) = 1;
