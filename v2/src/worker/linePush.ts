/**
 * LINE 推播
 *
 * 卡片版型照舊系統 GAS 那套（apps-script/Code.js 的 getFlexMessage）：
 * 客人從本店換到潮州店，收到的通知不該長得像另一個系統。
 *
 * ⚠️ 推播一律是「送出去就算了」——失敗只記 log，**絕對不能讓預約寫入失敗**。
 *    客人已經訂到位子了，卻因為 LINE 送不出去而回報失敗，是最糟的結果。
 *    呼叫端用 ctx.waitUntil() 丟到背景，回應不等它。
 */

import type { Env } from "./index";

export type NotifyKind = "new" | "cancel";

export interface NotifyBooking {
  date: string;
  /** `HH:MM` */
  time: string;
  name: string;
  name2: string | null;
  phone: string;
  type: string;
  remark: string | null;
  /** 要推給誰（監護人情境下不是本人）。null 就不推 */
  notifyLineUserId: string | null;
  /** 店家群組看的暱稱，沒有就留空 */
  lineName?: string | null;
}

const ROSE = "#d68095";
const GREY = "#9e9e9e";
const BLUE = "#5DADE2";   // 明日提醒，沿用舊系統那張卡片的藍

/** 組合同行者：一位就是姓名，兩位就是「A、B」 */
function combinedName(b: NotifyBooking): string {
  return b.name2 ? `${b.name}、${b.name2}` : b.name;
}

/**
 * Flex 卡片。版型與舊系統一致：彩色標題列、中間大字日期時間、下方按鈕。
 */
function card(opts: {
  title: string;
  greeting: string;
  date: string;
  time: string;
  color: string;
  isCancel: boolean;
  link?: string;
}) {
  const body: unknown[] = [
    { type: "text", text: opts.greeting, wrap: true, color: "#555555", size: "md", align: "center" },
    { type: "separator", margin: "lg" },
    { type: "text", text: opts.date, weight: "bold", size: "xl", margin: "lg", align: "center", color: opts.color },
    { type: "text", text: opts.time, weight: "bold", size: "3xl", margin: "sm", align: "center", color: "#333333" },
    { type: "separator", margin: "lg" },
    {
      type: "text",
      text: opts.isCancel ? "本預約已失效" : "👇 請點擊下方按鈕進行操作 👇",
      size: "xs", color: "#aaaaaa", align: "center", margin: "lg",
    },
  ];

  const flex: Record<string, unknown> = {
    type: "flex",
    altText: `${opts.title}：${opts.date} ${opts.time}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box", layout: "vertical", backgroundColor: opts.color, paddingAll: "15px",
        contents: [{ type: "text", text: opts.title, color: "#ffffff", weight: "bold", size: "lg", align: "center" }],
      },
      body: { type: "box", layout: "vertical", contents: body },
    },
  };

  // 取消的卡片不放按鈕：已經失效了，點進去也沒事可做
  if (!opts.isCancel && opts.link) {
    (flex.contents as Record<string, unknown>).footer = {
      type: "box", layout: "vertical", paddingAll: "20px",
      contents: [{
        type: "button", style: "link", height: "sm", color: "#666666",
        action: { type: "uri", label: "❌ 更改或取消預約", uri: opts.link },
      }],
    };
  }
  return flex;
}

/**
 * 送一則訊息。失敗只記 log，不往外丟例外。
 *
 * 回傳有沒有真的送出去——排程的提醒要靠這個決定該不該標記 reminded_at，
 * 標了卻其實沒送出去，客人就永遠收不到那則提醒了。
 */
async function push(env: Env, to: string, message: unknown): Promise<boolean> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error("沒有設定 LINE_CHANNEL_ACCESS_TOKEN，略過推播");
    return false;
  }
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, messages: [message] }),
    });
    if (!res.ok) {
      // 400 通常是 userId 不屬於這個 provider；403 是好友關係或權限問題
      console.error("LINE 推播失敗", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("LINE 推播例外", err);
    return false;
  }
}

/**
 * 一筆預約的通知：客人一則、店家群組一則。
 *
 * 店家群組要有 STORE_GROUP_ID 才會送——那個 id 得先把官方帳號拉進群組、
 * 由 webhook 事件取得，現在還沒做，所以沒設就自動略過。
 */
export async function notifyBooking(
  env: Env,
  storeName: string,
  b: NotifyBooking,
  kind: NotifyKind,
): Promise<void> {
  const who = combinedName(b);
  const remark = b.remark?.trim() || "無";
  const link = env.LIFF_MY_URL || "";

  // ── 客人 ──────────────────────────────────────────
  if (b.notifyLineUserId) {
    const greeting =
      kind === "cancel"
        ? `👋 ${who} 您好\n您的預約已「取消」。期待下次為您服務！`
        : `👋 ${who} 您好\n您的預約已保留，詳細資訊如下：\n(備註: ${remark})`;

    await push(env, b.notifyLineUserId, card({
      title: `${storeName}通知`,
      greeting,
      date: b.date,
      time: b.time,
      color: kind === "cancel" ? GREY : ROSE,
      isCancel: kind === "cancel",
      link,
    }));
  }

  // ── 店家群組 ──────────────────────────────────────
  if (env.STORE_GROUP_ID) {
    const nick = b.lineName?.trim();
    const shown = nick ? `${who} (${nick})` : who;
    const title = kind === "cancel" ? "❌ 預約已被取消" : "📲 新增預約 (客人自訂)";
    const greeting =
      `有一筆預約${kind === "cancel" ? "取消" : "新增"}：\n` +
      `(${shown} - ${b.type})\n電話：${b.phone}\n備註：${remark}`;

    await push(env, env.STORE_GROUP_ID, card({
      title,
      greeting,
      date: b.date,
      time: b.time,
      color: kind === "cancel" ? GREY : ROSE,
      isCancel: kind === "cancel",
      link,
    }));
  }
}

/**
 * 前一天的提醒（排程每天跑一次，見 reminders.ts）。
 *
 * 只推給客人本人，不推店家群組——店家要的是「明天有哪些單」的總覽，
 * 不是一位客人一張卡片把群組洗版。
 *
 * 回傳有沒有送出去，排程要靠它決定該不該把這筆標成已提醒。
 */
export async function notifyReminder(env: Env, b: NotifyBooking): Promise<boolean> {
  if (!b.notifyLineUserId) return false;

  const with2 = b.name2?.trim() || "無";
  const remark = b.remark?.trim() || "無";
  const greeting =
    `👋 ${b.name} 您好\n提醒您，明天有預約，期待您的光臨！\n\n` +
    `【同行】${with2}\n【備註】${remark}`;

  return push(env, b.notifyLineUserId, card({
    title: "📅 明日預約提醒",
    greeting,
    // 舊系統就是在日期後面補「(明天)」，客人看一眼就知道是哪天
    date: `${b.date} (明天)`,
    time: b.time,
    color: BLUE,
    isCancel: false,
    link: env.LIFF_MY_URL || "",
  }));
}
