/**
 * LINE Messaging API 的 webhook
 *
 * 它只為了一件事存在：**取得店家群組的 ID**。
 * 群組 ID 沒有任何介面查得到，只有在官方帳號被加進群組時，
 * LINE 會把它放在 webhook 事件裡送過來——錯過就只能退出群組再加一次。
 *
 * 所以收到 join 事件就直接寫進 stores.line_group_id，被踢出去就清掉。
 * 中間不需要任何人把 ID 抄來抄去，也不用重新部署。
 *
 * ⚠️ 這支是全世界都打得到的網址，一定要驗簽章：
 *    沒驗的話，任何人都能偽造一個 join 事件，把通知導到自己的群組。
 */

import type { Env } from "./index";
import { sb, type Store } from "./supabase";

interface LineSource {
  type: "user" | "group" | "room";
  groupId?: string;
  roomId?: string;
  userId?: string;
}

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type: string; text?: string };
}

/**
 * 驗 `X-Line-Signature`：body 的 HMAC-SHA256，用 channel secret 當金鑰，Base64。
 *
 * 一定要用「收到的原始字串」去算，不能先 JSON.parse 再 stringify——
 * 重新序列化出來的空白與鍵順序跟原文不一樣，簽章永遠對不起來。
 */
async function verifySignature(
  secret: string,
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));

  // btoa 只吃 latin1，所以先把 bytes 轉成字元再編碼
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // 逐字元比對但不提早結束：比對時間不隨「對到第幾個字」變化，
  // 免得洩漏正確簽章的前綴
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/** 回一則訊息。reply token 只能用一次、而且幾十秒就過期，失敗只記 log */
async function reply(env: Env, replyToken: string, text: string): Promise<void> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) {
      console.error("LINE 回覆失敗", res.status, (await res.text()).slice(0, 300));
    }
  } catch (err) {
    console.error("LINE 回覆例外", err);
  }
}

async function setGroupId(env: Env, store: Store, groupId: string | null): Promise<void> {
  await sb(env, `stores?id=eq.${store.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ line_group_id: groupId }),
  });
}

/**
 * 處理一批事件。
 *
 * LINE 一次可能送多個事件，而且要求**很快**回 200——慢了它會重送，
 * 重送的事件跟原本的長得一模一樣。所以這裡的處理都是「設成某個值」
 * 而不是「加一筆」，重複收到同一個事件結果也一樣。
 */
async function handleEvents(env: Env, store: Store, events: LineEvent[]): Promise<void> {
  for (const ev of events) {
    const src = ev.source;

    // 被加進群組／多人聊天室 → 記下 ID，之後的預約通知就發到這裡
    if (ev.type === "join" && src) {
      const id = src.groupId ?? src.roomId ?? null;
      if (!id) continue;

      await setGroupId(env, store, id);
      console.log("已記錄店家群組", id);

      if (ev.replyToken) {
        await reply(
          env,
          ev.replyToken,
          `✅ ${store.name} 預約系統已連上這個群組。\n` +
            `之後有新預約或取消都會通知到這裡。`,
        );
      }
      continue;
    }

    // 被踢出群組 → 清掉，不然之後每筆預約都會往一個進不去的群組推
    if (ev.type === "leave" && src) {
      const id = src.groupId ?? src.roomId ?? null;
      if (id && id === store.line_group_id) {
        await setGroupId(env, store, null);
        console.log("已離開店家群組，清除設定", id);
      }
      continue;
    }

    /*
     * 在群組裡打「群組ID」會回報目前狀態。
     *
     * 留這個是因為 join 事件只在「加入的那一刻」發生一次：
     * 如果當下 webhook 還沒設好、或訊息被漏掉，除了退出群組再加一次之外
     * 就沒有別的辦法了。有這句可以直接確認到底連上了沒。
     */
    if (ev.type === "message" && ev.message?.type === "text" && ev.replyToken) {
      const text = (ev.message.text ?? "").trim();
      if (text === "群組ID" || text.toLowerCase() === "groupid") {
        const id = src?.groupId ?? src?.roomId ?? null;
        if (id && id !== store.line_group_id) {
          await setGroupId(env, store, id);
        }
        await reply(
          env,
          ev.replyToken,
          id
            ? `✅ 已連上這個群組\nID：${id}`
            : "這裡是一對一聊天，不是群組，沒有群組 ID。",
        );
      }
    }
  }
}

/**
 * Webhook 的入口。
 *
 * 不管處理成功與否都回 200：LINE 收到非 2xx 會不停重送，
 * 而我們這邊的失敗（例如資料庫忙線）重送也救不回來，只會把 log 灌爆。
 * 唯一回非 200 的情況是簽章不對——那代表對方根本不是 LINE。
 */
export async function handleLineWebhook(
  env: Env,
  request: Request,
  store: Store,
): Promise<Response> {
  if (!env.LINE_CHANNEL_SECRET) {
    console.error("沒有設定 LINE_CHANNEL_SECRET，無法驗證 webhook");
    return new Response("not configured", { status: 503 });
  }

  const raw = await request.text();
  const ok = await verifySignature(
    env.LINE_CHANNEL_SECRET,
    raw,
    request.headers.get("x-line-signature"),
  );
  if (!ok) {
    console.error("webhook 簽章不符，已拒絕");
    return new Response("bad signature", { status: 403 });
  }

  try {
    const body = JSON.parse(raw) as { events?: LineEvent[] };
    await handleEvents(env, store, body.events ?? []);
  } catch (err) {
    console.error("處理 webhook 失敗", err);
  }

  return new Response("ok");
}
