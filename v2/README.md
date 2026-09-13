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

## 目前進度

- [x] Supabase schema、RLS、後台政策
- [x] Worker 骨架與 LINE token 驗證
- [x] React 後台：登入 / 未授權 / 儀表板
- [ ] 後台功能：預約管理、會員清單、營業日設定
- [ ] 客人端 LIFF 預約頁
- [ ] LINE 推播、Google 日曆同步、排程

## 注意

LINE provider 目前**暫時借用本店的**（channel `2009018559`）。
換成潮州店自己的 provider 時，**所有已收集的 `line_user_id` 會全部作廢**
——LINE userId 是 per-provider 的。所以測試期間不要接真客人。
