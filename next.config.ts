import type { NextConfig } from "next";

const SUPABASE_URL = "https://fqkxlisenfrhkermwsar.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxa3hsaXNlbmZyaGtlcm13c2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTYxNDQsImV4cCI6MjEwMzMzMjE0NH0.kV2fbNf6fGJg62psls9Z6JSyjBaNKTC_z5R9COddHVQ";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  },
};

export default nextConfig;
