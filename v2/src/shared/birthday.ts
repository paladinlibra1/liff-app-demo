/**
 * 生日的檢查規則（前後端共用）
 *
 * 沿用舊系統：5 歲以下、95 歲以上一律當成填錯。最常見的是把民國年
 * 打成西元年（民國 80 年打成 1980），那種單店家事後看不出來是筆錯字，
 * 只會變成一個 46 歲的「新客體驗」。
 *
 * 前端擋是為了當下就講清楚，後端擋才是真的把關——客人端的檢查繞得過去。
 */

export const AGE_MIN = 5;
export const AGE_MAX = 95;

/** `YYYY-MM-DD` → 足歲；格式不對回 null */
export function ageOf(birthday: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;

  const d = new Date(birthday + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  // 擋掉 2026-02-31 這種「解析得出來但不存在」的日期
  if (d.toISOString().slice(0, 10) !== birthday) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/**
 * 檢查生日。沒問題回 null，有問題回可以直接顯示給客人看的句子。
 */
export function birthdayError(birthday: string): string | null {
  const age = ageOf(birthday);
  if (age === null) return "生日格式不正確";

  if (age <= AGE_MIN || age >= AGE_MAX) {
    return (
      `生日不合理：${birthday} 換算是 ${age} 歲。` +
      `年齡要介於 ${AGE_MIN + 1} 到 ${AGE_MAX - 1} 歲之間，` +
      `請確認是不是把民國年打成西元年了。`
    );
  }
  return null;
}
