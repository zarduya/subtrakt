// Shared name-normalisation used for grouping and override matching.
// Must stay in sync between scan, subscriptions, and overrides routes.

export const ALIAS_MAP: Record<string, string> = {
  "anthropic": "claude",
  "anthropic claude": "claude",
}

const STRIP_LEADING_ARTICLE_RE = /^(the|an?)\s+/i
const STRIP_PLAN_WORDS_RE =
  /\b(ai|vpn|pro|plus|premium|basic|standard|individual|family|personal|plan|subscription|membership|app)\b/gi
const STRIP_PUNCT_RE = /[^\w\s]/g

export function normalizeName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(STRIP_PUNCT_RE, " ")
    .replace(STRIP_LEADING_ARTICLE_RE, "")
    .replace(STRIP_PLAN_WORDS_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
  return ALIAS_MAP[n] ?? n
}
