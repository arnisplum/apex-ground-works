import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn(
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see admin/.env.example).",
  );
}

export const supabase = createClient(url || "", anon || "");
