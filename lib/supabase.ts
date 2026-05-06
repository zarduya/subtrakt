import { createClient } from "@supabase/supabase-js"

// createClient appends /rest/v1 itself — strip it if the env var already includes it
const rawUrl = (process.env.SUPABASE_URL ?? "https://placeholder.supabase.co")
  .replace(/\/rest\/v1\/?$/, "")
  .replace(/\/$/, "")

// Service role key bypasses RLS — safe because this module is only imported by server-side API routes.
// Placeholder fallback keeps the build from throwing; real keys are required at runtime.
export const supabase = createClient(rawUrl, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "build-placeholder")
