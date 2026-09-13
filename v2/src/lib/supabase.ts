import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請檢查 .env");
}

/**
 * 後台專用的 Supabase client。
 *
 * 這把是 publishable key，會被打包進 bundle、公開可見——這是設計如此，
 * 它的安全性完全靠 RLS。真正的權限判斷在資料庫，不在這裡。
 */
export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
