/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** 客人端的 LIFF ID。本機沒設會進入預覽模式（只看畫面、不能送出） */
  readonly VITE_LIFF_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
