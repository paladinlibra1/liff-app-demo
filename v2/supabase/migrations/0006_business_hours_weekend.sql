-- ╔══════════════════════════════════════════════════════════╗
-- ║  營業時段：saturday → weekend                              ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- 舊系統的 config.js 只有 weekday / saturday 兩組，週日沒有設定
-- （店裡本來就不開週日，靠 operatingDays 擋掉）。
--
-- 潮州店要「平日／假日分開、而且店家自己能改」，所以改成：
--   weekday  → 週一～週五
--   weekend  → 週六、週日
--
-- 週日要不要開仍然由 operating_days 決定，這裡只是先有一組時段可用，
-- 不會因為週日沒有設定而開不了。

update stores
set business_hours =
      (business_hours - 'saturday')
      || jsonb_build_object('weekend', business_hours -> 'saturday')
where business_hours ? 'saturday';

-- 之後所有店都用 weekday / weekend 這兩個 key，這裡把它寫進約束，
-- 免得哪天又混進 saturday 之類的舊名字。
alter table stores
  add constraint stores_business_hours_keys
  check (
    business_hours = '{}'::jsonb
    or (business_hours ?& array['weekday','weekend']
        and jsonb_typeof(business_hours -> 'weekday') = 'array'
        and jsonb_typeof(business_hours -> 'weekend') = 'array')
  );
