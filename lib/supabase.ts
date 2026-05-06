import { createClient } from "@supabase/supabase-js"

// createClient appends /rest/v1 itself — strip it if the env var already includes it
const rawUrl = process.env.SUPABASE_URL!.replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "")

export const supabase = createClient(rawUrl, process.env.SUPABASE_ANON_KEY!)
