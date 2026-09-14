# 潮州店預約系統 v2

React + Vite + Cloudflare Workers + Supabase。
**跟 repo 根目錄那套（本店的 Firestore 版）完全獨立**，互不影響。

## 怎麼跑起來

```bash
npm install
npm run build        # 先打包前端
npm run dev:worker   # 開 http://127.0.0.1:8788
```

一個網址同時服務前端和 API（前後端同源，所以不用處理 CORS）。

改前端時想要熱重載的話，另開一個視窗跑 `npm run dev`（Vite，5173 埠），
它會把 `/api` 轉給 8788 的 Worker。

## 指令

| 指令 | 用途 |
|---|---|
| `npm run build` | 打包前端到 `dist/` |
| `npm run dev` | Vite 開發伺服器（熱重載） |
| `npm run dev:worker` | Worker + 靜態檔，最接近正式環境 |
| `npm run typecheck` | 前端與 Worker 兩份 tsconfig 都檢查 |
| `npm run types` | 從遠端 Supabase 重新產生資料庫型別 |

## 架構

**認證分兩條路：**

| 誰 | 怎麼認證 | 資料怎麼讀 |
|---|---|---|
| 後台店員 | Supabase 原生 Auth | 直連 Supabase，RLS 把關 |
| 客人（LIFF） | Worker 驗 LINE token | 只走 Worker API，不直連資料庫 |

客人端不直連的原因：不必依賴即將淘汰的 legacy JWT secret，
而且 Worker 本來就要存在（LINE 推播、日曆、排程）。

**資料庫：** 所有表都開了 RLS，預設拒絕。
`is_store_admin()` / `is_store_owner()` 是 `SECURITY DEFINER`，
否則 `store_admins` 的政策查自己會無限遞迴。

## 機密

repo 是公開的，金鑰一律不進版控。

- `.env`（已被 gitignore）放前端用的 `VITE_SUPABASE_*`。
  publishable key 會被打包進 bundle、公開可見，這是設計如此，靠 RLS 保護。
- **任何 secret key 都不可以加 `VITE_` 前綴**，那會被編進前端。
  Worker 的機密用 `npx wrangler secret put <名稱>`。

## 線上網址

<https://colorfashion-chaozhou.colorfashion-v2.workers.dev>

| 路徑 | 是什麼 | 怎麼開 |
|---|---|---|
| `/` | 客人端預約頁 | LIFF `2011603381-Hks28cwY` |
| `/my` | 我的預約／取消 | LIFF `2011603381-dBGrCXYs` |
| `/admin` | 後台 | 一般瀏覽器，要登入 |

部署是 `npm run deploy`（從本機打包上傳），**跟 push 到 GitHub 無關**——
推上 GitHub 不會讓線上版更新，這點跟舊系統的 GitHub Pages 不一樣。

## 目前進度

- [x] Supabase schema、RLS、後台政策
- [x] Worker 骨架與 LINE token 驗證
- [x] React 後台：登入 / 未授權 / 儀表板
- [x] 後台功能：預約管理、會員清單、營業日設定（平日／假日營業時間）
- [x] 客人端：預約頁與「我的預約」，已接上 LIFF
- [x] 部署到 Cloudflare，兩個 LIFF 端點已指過來
- [ ] 後台帳號（`store_admins` 還是空的，沒人進得去）
- [ ] LINE 推播、Google 日曆同步、排程

## 注意

LINE 的 `userId` 是 **per-provider** 的。LINE Login channel（LIFF 用）與
Messaging API channel（推播用）**必須開在同一個 provider 底下**，
否則前端存下來的 userId 拿去推播會找不到人。

潮州店用自己的 provider，LINE Login channel 是 `2011603381`。
