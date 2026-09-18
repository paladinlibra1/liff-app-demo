/**
 * 沉睡客關懷訊息
 *
 * 後台平常直連 Supabase，只有「要發 LINE」的動作走 Worker——推播 token
 * 只存在這裡。所以這支路徑一樣要自己 verifyAdmin()，而且每一筆都限定
 * store_id：不能因為多開一支路徑，就讓誰都能用店家名義群發訊息。
 *
 * 名單是前端算出來的（最近一次到店超過 90 天），但「要發給誰」不能照單全收：
 * 這裡會自己再查一次會員，確認那些 id 真的是這家店的、而且有綁 LINE。
 */

import type { Env } from "./index";
import { sb, type Store } from "./supabase";
import { pushText } from "./linePush";

/** 一次最多發幾位。群發是不可逆的，手滑按到全選也不該一次打到幾百人 */
const MAX_PER_CALL = 50;

export class FollowUpError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
  }
}

interface MemberRow {
  id: string;
  name: string;
  line_user_id: string | null;
}

export interface SendResult {
  sent: number;
  /** 沒發成功的人與原因，前端要一個一個講清楚 */
  failed: { id: string; name: string; reason: string }[];
}

/** 範本裡的 {{name}} 換成客人姓名。其餘文字原樣送出 */
function render(template: string, name: string): string {
  return template.replaceAll("{{name}}", name || "您");
}

export async function sendFollowUps(
  env: Env,
  store: Store,
  memberIds: string[],
): Promise<SendResult> {
  const ids = [...new Set(memberIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!ids.length) throw new FollowUpError("沒有指定要發給誰");
  if (ids.length > MAX_PER_CALL) {
    throw new FollowUpError(`一次最多發送 ${MAX_PER_CALL} 位，請分批送`);
  }

  // 範本存在店家那一列，店家可以在後台改
  const rows = await sb<{ dormant_message: string }[]>(
    env,
    `stores?id=eq.${store.id}&select=dormant_message&limit=1`,
  );
  const template = rows[0]?.dormant_message?.trim();
  if (!template) throw new FollowUpError("還沒有設定關懷訊息範本");

  // 只認這家店的會員。前端送什麼 id 過來都要在這裡被過濾一次
  const members = await sb<MemberRow[]>(
    env,
    `members?store_id=eq.${store.id}&id=in.(${ids.join(",")})` +
      `&select=id,name,line_user_id`,
  );

  const result: SendResult = { sent: 0, failed: [] };
  const found = new Set(members.map((m) => m.id));
  for (const id of ids) {
    if (!found.has(id)) result.failed.push({ id, name: "", reason: "找不到這位會員" });
  }

  for (const m of members) {
    if (!m.line_user_id) {
      result.failed.push({ id: m.id, name: m.name, reason: "沒有綁定 LINE" });
      continue;
    }
    const ok = await pushText(env, m.line_user_id, render(template, m.name));
    if (!ok) {
      result.failed.push({ id: m.id, name: m.name, reason: "LINE 推播失敗（可能已封鎖官方帳號）" });
      continue;
    }

    /*
     * 記下發送時間。這是唯一「發過了」的證據——冷卻期靠它算，
     * 所以推播成功才寫，失敗的下次還要看得到。
     *
     * 寫入失敗不能讓整批停下來：訊息已經送出去了，再拋例外只會讓店家
     * 以為沒送成功而再按一次，客人就收到兩則。
     */
    try {
      // 用 RPC 而不是 upsert：累計次數要在原值上加一，
      // PostgREST 的 upsert 只會整列蓋掉，次數永遠停在 1。
      await sb(env, "rpc/record_followup", {
        method: "POST",
        body: JSON.stringify({ p_member_id: m.id, p_store_id: store.id }),
      });
    } catch (err) {
      console.error("關懷紀錄寫入失敗", m.id, err);
    }

    result.sent++;
  }

  return result;
}
