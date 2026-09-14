/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** 預約頁（/）的 LIFF ID。沒設會進入預覽模式（只看畫面、不能送出） */
  readonly VITE_LIFF_ID_BOOKING?: string;
  /** 我的預約（/my）的 LIFF ID */
  readonly VITE_LIFF_ID_MY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
