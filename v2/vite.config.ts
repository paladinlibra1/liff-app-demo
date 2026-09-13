import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist" },
  server: {
    // 開發時把 /api 轉給本機的 Worker，跟正式環境同源的行為一致
    proxy: { "/api": "http://127.0.0.1:8788" },
  },
});
