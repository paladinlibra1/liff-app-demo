/**
 * 把 Google 服務帳戶的金鑰灌進 Cloudflare Worker secret。
 *
 *   node scripts/set-google-secrets.mjs <下載的服務帳戶 .json 路徑>
 *
 * 為什麼要有這支：私鑰是多行的 PEM，用 `wrangler secret put` 手動貼很容易
 * 貼壞（少一行、換行被吃掉），而且貼過的東西會留在終端機紀錄裡。
 * 這支直接從 JSON 讀出來、用管道餵給 wrangler，金鑰不經過剪貼簿。
 *
 * ⚠️ 那個 .json 檔不要放進這個 repo——repo 是公開的。
 *    .gitignore 已經擋掉 `gcp-*.json` 與 `*.secrets.json`，但放在專案外面更保險。
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const path = process.argv[2];
if (!path) {
  console.error("用法：node scripts/set-google-secrets.mjs <服務帳戶 .json 路徑>");
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`讀不到或解析不了 ${path}：${err.message}`);
  process.exit(1);
}

if (!key.client_email || !key.private_key) {
  console.error("這個 JSON 裡沒有 client_email / private_key，確認一下是不是服務帳戶的金鑰檔");
  process.exit(1);
}

const put = (name, value) => {
  // Windows 上 npx 是 .cmd，要指名；用 shell: true 會被 Node 警告參數沒跳脫
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const r = spawnSync(npx, ["wrangler", "secret", "put", name], {
    input: value, stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) {
    console.error(`設定 ${name} 失敗`);
    process.exit(1);
  }
};

put("GOOGLE_SA_EMAIL", key.client_email);
put("GOOGLE_SA_PRIVATE_KEY", key.private_key);

console.log(`\n✅ 已設定服務帳戶：${key.client_email}`);
console.log("   別忘了把要同步的那本 Google 日曆「與特定使用者共用」給這個信箱，權限選「變更活動」。");
