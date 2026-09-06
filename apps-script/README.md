# Apps Script 後端（預約通知 / Google 日曆 / 排程）

線上專案：`script.google.com` → `Colorfashion 預約系統`
（scriptId 在 `.clasp.json`）。這個資料夾是它的版控副本，
**不是**被 GitHub Pages 服務的檔案。

## 用 clasp 同步

```
cd apps-script
clasp pull     # 把線上的改動拉下來（線上是真正在跑的那份）
clasp push -f  # 把本機的改動推上去
```

`clasp push` 會**整份覆蓋**線上程式碼。如果有人直接在網頁編輯器改過，
先 `clasp pull` 再改，否則會蓋掉對方的修改。

## 改完程式碼一定要重新部署

網頁應用程式服務的是**部署當下那個版本**，`clasp push` 只更新編輯器裡的
程式碼。要讓 webhook 真的用到新版：
部署 → 管理部署作業 → ✏️ 編輯 → 版本選「新版本」→ 部署。

## 機密不在這裡

`CHANNEL_ACCESS_TOKEN`、`CALENDAR_ID`、`SHEET_ID`、`GROUP_ID` 存在
Apps Script 的「專案設定 → 指令碼屬性」，程式碼只用
`PropertiesService.getScriptProperties().getProperty(...)` 讀取。
這個 repo 是公開的，**任何機密都不可以寫進程式碼**。
