import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "@/lib/supabase"
import { normalizeName, ALIAS_MAP } from "@/lib/normalize"

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract subscription information from email content.

Rules:
- isSubscription: true ONLY if the email explicitly confirms a RECURRING service — it must mention a recurring plan, auto-renewal, next billing date, membership, or "subscribe & save". A plain order confirmation or purchase receipt for physical goods or a one-time digital purchase (e.g. a protein supplement order, an Amazon product order, a one-off app purchase) is NOT a subscription — return isSubscription: false. When in doubt, return isSubscription: false.
- Normalize serviceName to brand only: "Udemy Personal Plan" → "Udemy", "Google One 100GB" → "Google One", "Netflix Standard with Ads" → "Netflix"
- status: "active" if charged/renewed/active subscription, "cancelled" if cancellation confirmed, "trial" if in a free trial, "unknown" if unclear
- amount: the FINAL TOTAL charged including all VAT and taxes — never the pre-tax subtotal. If both a subtotal and a grand total appear in the email, always use the larger total figure. Extract the numeric value only (no currency symbol), null if not mentioned.
- currency: ISO 4217 code (USD, GBP, EUR, INR, etc.) or null if not mentioned
- billingCycle: "monthly", "yearly", "weekly", or null if not determinable
- renewalDate: "YYYY-MM-DD" or null — resolve relative dates like "renews in 7 days" using the receivedDate provided
- lastChargeDate: "YYYY-MM-DD" or null — the date the most recent charge occurred
- isTrial: true only if email explicitly mentions free trial, trial period, trial ends, or trial expiry
- trialEndDate: "YYYY-MM-DD" or null

Reply with ONLY valid JSON, no markdown fences, no explanation:
{"isSubscription":true,"serviceName":"...","status":"active","amount":null,"currency":null,"billingCycle":null,"renewalDate":null,"lastChargeDate":null,"isTrial":false,"trialEndDate":null}`

// ─── Marketplace / payment-processor domains ──────────────────────────────────
// These send billing emails on behalf of many different services. Never use them
// as a grouping key — doing so merges unrelated subscriptions (e.g. AppleCare+
// and Surfshark VPN both arrive from apple.com).
const MARKETPLACE_DOMAINS = new Set([
  "apple.com",
  "google.com",
  "paypal.com",
  "stripe.com",
  "amazon.com",
  "amazon.co.uk",
])

function senderDomain(from: string): string {
  const host = from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? ""
  const parts = host.split(".")
  if (parts.length < 2) return host
  // Handle two-level ccTLDs like .co.uk, .com.au — take last 3 parts
  const last = parts[parts.length - 1]
  const secondLast = parts[parts.length - 2]
  if (last.length === 2 && secondLast.length <= 3 && parts.length >= 3) {
    return parts.slice(-3).join(".")
  }
  return parts.slice(-2).join(".")
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface GmailPart {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
  headers?: { name: string; value: string }[]
}

interface GmailMessage {
  id: string
  internalDate?: string
  payload?: GmailPart
}

interface ParsedSub {
  isSubscription: boolean
  serviceName?: string
  status?: string
  amount?: number | null
  currency?: string | null
  billingCycle?: string | null
  renewalDate?: string | null
  lastChargeDate?: string | null
  isTrial?: boolean
  trialEndDate?: string | null
  emailId?: string
  from?: string
  subject?: string
  date?: string
  internalDate?: string
}

// ─── Body extraction ─────────────────────────────────────────────────────────

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  } catch {
    return ""
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractBodyText(payload: GmailPart): string {
  let plainText = ""
  let htmlText = ""

  function walk(part: GmailPart) {
    const mime = part.mimeType || ""
    if (mime === "text/plain" && part.body?.data) {
      plainText += decodeBase64Url(part.body.data) + "\n"
    } else if (mime === "text/html" && part.body?.data) {
      htmlText += decodeBase64Url(part.body.data) + "\n"
    }
    if (part.parts) for (const p of part.parts) walk(p)
  }

  walk(payload)
  return plainText || stripHtml(htmlText)
}

const RELEVANT_RE = /renew|renewal|next.payment|billing|charged|amount|total|trial|cancel|plan|subscription|invoice|receipt/i

function trimToRelevant(text: string, maxLen = 3000): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  if (collapsed.length <= maxLen) return collapsed

  const words = collapsed.split(" ")
  const WINDOW = 60
  const keep = new Set<number>()

  for (let i = 0; i < words.length; i++) {
    if (RELEVANT_RE.test(words[i])) {
      for (let j = Math.max(0, i - WINDOW); j < Math.min(words.length, i + WINDOW); j++) keep.add(j)
    }
  }

  if (keep.size === 0) return collapsed.slice(0, maxLen)

  const sorted = Array.from(keep).sort((a, b) => a - b)
  let result = ""
  let prev = -1
  for (const idx of sorted) {
    if (prev !== -1 && idx > prev + 1) result += " ... "
    result += words[idx] + " "
    prev = idx
  }
  return result.trim().slice(0, maxLen)
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayUTC(): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Roll dateStr forward by billingCycle until it is >= today. Returns null if billingCycle unknown. */
function rollDateForward(dateStr: string, billingCycle: string | null | undefined): string | null {
  if (!billingCycle) return null
  const base = new Date(dateStr)
  if (isNaN(base.getTime())) return null
  const today = todayUTC()
  let next = new Date(base)

  if (billingCycle === "monthly") {
    while (next < today) next = new Date(new Date(next).setMonth(next.getMonth() + 1))
  } else if (billingCycle === "yearly") {
    while (next < today) next = new Date(new Date(next).setFullYear(next.getFullYear() + 1))
  } else if (billingCycle === "weekly") {
    while (next < today) next = new Date(new Date(next).setDate(next.getDate() + 7))
  } else {
    return null
  }

  return next.toISOString().split("T")[0]
}

/** Fix a renewal date: if in the past, roll forward or null out. */
function fixRenewalDate(renewalDate: string | null | undefined, billingCycle: string | null | undefined): string | null {
  if (!renewalDate) return null
  const d = new Date(renewalDate)
  if (isNaN(d.getTime())) return null
  if (d >= todayUTC()) return renewalDate
  return rollDateForward(renewalDate, billingCycle) // returns null if billingCycle unknown
}

// ─── Lapsed detection ─────────────────────────────────────────────────────────
// Mark active subscriptions as "lapsed" when the last charge is older than one
// billing cycle + a grace window (45d monthly, 13 months yearly, 14d weekly).

function markLapsedIfStale(sub: ParsedSub, todayMs: number): ParsedSub {
  if (sub.status !== "active" || !sub.lastChargeDate || !sub.billingCycle) return sub
  const daysSince = Math.floor(
    (todayMs - new Date(sub.lastChargeDate + "T00:00:00Z").getTime()) / 86_400_000
  )
  const isLapsed =
    (sub.billingCycle === "monthly" && daysSince > 45) ||
    (sub.billingCycle === "yearly" && daysSince > 395) ||
    (sub.billingCycle === "weekly" && daysSince > 14)
  if (!isLapsed) return sub
  console.log(
    `[scan] lapsed: "${sub.serviceName}" lastCharge=${sub.lastChargeDate} ${daysSince}d ago cycle=${sub.billingCycle}`
  )
  return { ...sub, status: "lapsed" }
}

// ─── Batch helper ─────────────────────────────────────────────────────────────

async function processInBatches<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    results.push(...(await Promise.all(items.slice(i, i + batchSize).map(fn))))
  }
  return results
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const accessToken = session.accessToken
  if (!accessToken) return NextResponse.json({ error: "No access token" }, { status: 401 })

  const query = [
    "newer_than:12m",
    "subject:(subscription OR billing OR renewal OR receipt OR payment OR invoice OR \"free trial\" OR \"trial ends\" OR \"auto-renew\" OR \"your plan\" OR \"plan renewal\" OR membership OR charged OR \"your account\")",
    "-subject:(OTP OR \"one-time password\" OR \"verification code\" OR \"sign-in code\" OR \"login code\" OR \"password reset\" OR shipment OR delivered OR tracking)",
    "-category:promotions",
  ].join(" ")

  const allMessageIds: { id: string }[] = []
  let pageToken: string | undefined

  try {
    do {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages")
      url.searchParams.set("q", query)
      url.searchParams.set("maxResults", "100")
      if (pageToken) url.searchParams.set("pageToken", pageToken)

      const searchRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
      const searchData = await searchRes.json()

      if (searchData.messages) allMessageIds.push(...searchData.messages)
      pageToken = searchData.nextPageToken
    } while (pageToken && allMessageIds.length < 200)
  } catch (err) {
    console.error("[scan] Gmail search error:", JSON.stringify(err))
    return NextResponse.json({ error: "Gmail search failed" }, { status: 500 })
  }

  console.log("[scan] Gmail search returned", allMessageIds.length, "messages")
  if (allMessageIds.length === 0) return NextResponse.json({ subscriptions: [], trials: [], total: 0 })

  // Fetch full message content in batches of 5
  const emails = await processInBatches(
    allMessageIds.slice(0, 200),
    5,
    async (msg: { id: string }) => {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        const msgData: GmailMessage = await msgRes.json()
        const headers = msgData.payload?.headers || []
        const subject = headers.find((h) => h.name === "Subject")?.value || "No subject"
        const from = headers.find((h) => h.name === "From")?.value || "Unknown"
        const date = headers.find((h) => h.name === "Date")?.value || ""
        const internalDate = msgData.internalDate || "0"
        const rawBody = msgData.payload ? extractBodyText(msgData.payload) : ""
        const bodyText = trimToRelevant(rawBody)
        return { id: msg.id, subject, from, date, internalDate, bodyText }
      } catch (err) {
        console.error("[scan] Gmail fetch error for", msg.id, ":", JSON.stringify(err))
        return { id: msg.id, subject: "", from: "", date: "", internalDate: "0", bodyText: "" }
      }
    }
  )

  // Call Claude in batches of 5
  const results = await processInBatches(
    emails,
    5,
    async (email) => {
      try {
        const receivedDate = email.date
          ? new Date(email.date).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0]

        const userContent = `Received: ${receivedDate}
From: ${email.from}
Subject: ${email.subject}

Body:
${email.bodyText}`

        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 400,
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        })

        const text = message.content[0].type === "text" ? message.content[0].text : ""
        const cleaned = text.replace(/```json\n?|```/g, "").trim()
        const parsed: ParsedSub = JSON.parse(cleaned)
        console.log(`[scan] email from="${email.from}" subject="${email.subject}" parsed:`, JSON.stringify(parsed))
        return { ...parsed, emailId: email.id, from: email.from, subject: email.subject, date: email.date, internalDate: email.internalDate }
      } catch (err) {
        console.error(`[scan] claude error for "${email.subject}":`, JSON.stringify(err))
        return { isSubscription: false, emailId: email.id, internalDate: email.internalDate } as ParsedSub
      }
    }
  )

  const allSubs = results.filter((s) => s.isSubscription)

  // ─── Deduplicate by normalized name; use sender domain only for non-marketplace senders ──
  const nameKeyToCanonical = new Map<string, string>()
  const domainToCanonical = new Map<string, string>()
  const groups = new Map<string, ParsedSub[]>()

  for (const sub of allSubs) {
    const nameKey = normalizeName(sub.serviceName || "")
    if (!nameKey) continue
    const domain = senderDomain(sub.from || "")
    const isMarketplace = MARKETPLACE_DOMAINS.has(domain)

    const canonical =
      ALIAS_MAP[nameKey] ??
      nameKeyToCanonical.get(nameKey) ??
      (!isMarketplace && domain ? domainToCanonical.get(domain) : undefined) ??
      nameKey

    if (!nameKeyToCanonical.has(nameKey)) nameKeyToCanonical.set(nameKey, canonical)
    if (!isMarketplace && domain && !domainToCanonical.has(domain)) {
      domainToCanonical.set(domain, canonical)
    }
    if (!groups.has(canonical)) groups.set(canonical, [])
    groups.get(canonical)!.push(sub)
  }

  // Log group membership before containment merge
  for (const [canonical, group] of groups) {
    console.log(
      `[scan] group "${canonical}" (${group.length} email${group.length === 1 ? "" : "s"}):`,
      group.map((s) => `"${s.serviceName}" from <${s.from}> — "${s.subject}"`).join(" | ")
    )
  }

  // ─── Containment merge: absorb groups whose key is a word-supersequence of a ─
  // shorter key — e.g. "new york times digital" absorbed into "new york times".
  // Only compares service-name keys, never sender domains.
  {
    const snapshot = Array.from(groups.keys())
    for (const shorter of snapshot) {
      const sw = shorter.split(" ")
      if (sw.length < 2) continue
      if (!groups.has(shorter)) continue
      for (const longer of snapshot) {
        if (longer === shorter || !groups.has(longer)) continue
        const lw = longer.split(" ")
        if (lw.length <= sw.length) continue
        const found = lw.some((_, i) => sw.every((w, j) => lw[i + j] === w))
        if (found) {
          console.log(`[scan] containment merge: "${longer}" → "${shorter}"`)
          groups.get(shorter)!.push(...groups.get(longer)!)
          groups.delete(longer)
        }
      }
    }
  }

  const todayStr = todayUTC().toISOString().split("T")[0]
  const todayMs = todayUTC().getTime()

  const rawDeduped: ParsedSub[] = []
  for (const [, group] of groups) {
    group.sort((a, b) => parseInt(b.internalDate || "0") - parseInt(a.internalDate || "0"))
    const newest = group[0]

    // Pick the display name with the most words (most complete/official looking)
    const displayName = group.reduce((best, s) => {
      const bw = best.split(" ").length
      const sw = (s.serviceName ?? "").split(" ").length
      return sw > bw ? s.serviceName! : best
    }, newest.serviceName ?? "")

    // Merge: most recent non-null value per field
    let amount: number | null = null
    let currency: string | null = null
    let billingCycle: string | null = null
    let renewalDate: string | null = null
    let lastChargeDate: string | null = null
    let trialEndDate: string | null = null

    for (const s of group) {
      if (amount === null && s.amount != null) amount = s.amount
      if (!currency && s.currency) currency = s.currency
      if (!billingCycle && s.billingCycle) billingCycle = s.billingCycle
      if (!renewalDate && s.renewalDate) renewalDate = s.renewalDate
      if (!lastChargeDate && s.lastChargeDate) lastChargeDate = s.lastChargeDate
      if (!trialEndDate && s.trialEndDate) trialEndDate = s.trialEndDate
    }

    // Fill missing renewal date from lastChargeDate + billingCycle
    if (!renewalDate && lastChargeDate && billingCycle) {
      renewalDate = rollDateForward(lastChargeDate, billingCycle)
    }
    // For trials, fall back to trialEndDate
    if (!renewalDate && newest.isTrial && trialEndDate) renewalDate = trialEndDate

    // Fix past renewal dates
    renewalDate = fixRenewalDate(renewalDate, billingCycle)

    // Cancelled: no renewal date
    const status = newest.status
    if (status === "cancelled") renewalDate = null

    rawDeduped.push({
      ...newest,
      serviceName: displayName,
      amount,
      currency,
      billingCycle,
      renewalDate,
      lastChargeDate,
      trialEndDate,
      status,
    })
  }

  // ─── Handle past trials + lapsed detection ───────────────────────────────
  const deduped: ParsedSub[] = []
  for (const sub of rawDeduped) {
    if (sub.isTrial && sub.trialEndDate && sub.trialEndDate < todayStr) {
      const hasLaterCharge = !!(sub.lastChargeDate && sub.lastChargeDate > sub.trialEndDate!)
      const hasEvidence = hasLaterCharge || !!sub.billingCycle
      if (hasEvidence) {
        const base = sub.lastChargeDate ?? sub.trialEndDate!
        const renewal = sub.billingCycle ? rollDateForward(base, sub.billingCycle) : null
        const promoted = { ...sub, isTrial: false, status: "active", renewalDate: renewal }
        deduped.push(markLapsedIfStale(promoted, todayMs))
      }
      // else: drop the expired trial entirely
    } else {
      deduped.push(markLapsedIfStale(sub, todayMs))
    }
  }

  console.log(
    "[scan] final deduplicated list:",
    JSON.stringify(
      deduped.map((s) => ({
        serviceName: s.serviceName,
        status: s.status,
        renewalDate: s.renewalDate,
        amount: s.amount,
        currency: s.currency,
        isTrial: s.isTrial,
      }))
    )
  )

  const trials = deduped.filter((s) => s.isTrial)
  const subscriptions = deduped.filter((s) => !s.isTrial)

  // ─── Persist to Supabase (atomic swap: insert first, delete old after) ────
  // Keeping old rows visible during the scan prevents a blank dashboard if the
  // user reloads while a rescan is in progress.
  const userEmail = session.user!.email!
  console.log(`[scan] saving ${deduped.length} subscriptions to Supabase for ${userEmail}`)

  const scannedAt = new Date().toISOString()

  if (deduped.length > 0) {
    const { error: insertErr } = await supabase.from("subscriptions").insert(
      deduped.map((sub) => ({
        user_email: userEmail,
        service_name: sub.serviceName,
        status: sub.status,
        amount: sub.amount,
        currency: sub.currency,
        renewal_date: sub.renewalDate,
        billing_cycle: sub.billingCycle,
        from_email: sub.from,
        subject: sub.subject,
        is_trial: sub.isTrial ?? false,
        scanned_at: scannedAt,
      }))
    )
    if (insertErr) {
      console.error("[scan] supabase insert error:", JSON.stringify(insertErr))
    } else {
      // Delete previous scan's rows only after the new ones are safely inserted
      const { error: deleteErr } = await supabase
        .from("subscriptions")
        .delete()
        .eq("user_email", userEmail)
        .lt("scanned_at", scannedAt)
      if (deleteErr) console.error("[scan] supabase delete old rows error:", JSON.stringify(deleteErr))
      else console.log(`[scan] inserted ${deduped.length} rows, deleted old scan rows`)
    }
  } else {
    // Scan found nothing — wipe existing rows
    const { error: deleteErr } = await supabase
      .from("subscriptions")
      .delete()
      .eq("user_email", userEmail)
    if (deleteErr) console.error("[scan] supabase delete error:", JSON.stringify(deleteErr))
  }

  // ─── Fetch overrides (matched on normalised name) ─────────────────────────
  const { data: overridesData } = await supabase
    .from("user_overrides")
    .select("service_name, action, custom_amount")
    .eq("user_email", userEmail)

  const hiddenNormNames = new Set<string>(
    (overridesData ?? [])
      .filter((o: { action: string }) => o.action === "not_subscription" || o.action === "free")
      .map((o: { service_name: string }) => normalizeName(o.service_name))
  )
  const amountOverrideMap = new Map<string, number>(
    (overridesData ?? [])
      .filter((o: { action: string; custom_amount: number | null }) => o.action === "edit_amount" && o.custom_amount != null)
      .map((o: { service_name: string; custom_amount: number }) => [normalizeName(o.service_name), o.custom_amount])
  )

  // ─── Reminders — future dates only, skip cancelled/lapsed/hidden ─────────
  const { error: delRemindErr } = await supabase.from("reminders").delete().eq("user_email", userEmail)
  if (delRemindErr) console.error("[scan] supabase reminders delete error:", JSON.stringify(delRemindErr))

  const reminderCandidates = deduped.filter(
    (s) =>
      s.renewalDate &&
      s.status !== "cancelled" &&
      s.status !== "lapsed" &&
      !hiddenNormNames.has(normalizeName(s.serviceName!))
  )
  const reminderRows = reminderCandidates.flatMap((sub) => {
    const renewal = new Date(sub.renewalDate!)
    const sevenDayStr = new Date(new Date(renewal).setDate(renewal.getDate() - 7)).toISOString().split("T")[0]
    const oneDayStr = new Date(new Date(renewal).setDate(renewal.getDate() - 1)).toISOString().split("T")[0]
    const rows = []
    if (sevenDayStr >= todayStr) rows.push({ user_email: userEmail, service_name: sub.serviceName, renewal_date: sub.renewalDate, remind_at: sevenDayStr, sent: false })
    if (oneDayStr >= todayStr) rows.push({ user_email: userEmail, service_name: sub.serviceName, renewal_date: sub.renewalDate, remind_at: oneDayStr, sent: false })
    return rows
  })

  if (reminderRows.length > 0) {
    const { error: remindErr } = await supabase.from("reminders").insert(reminderRows)
    if (remindErr) console.error("[scan] supabase reminders insert error:", JSON.stringify(remindErr))
    else console.log(`[scan] created ${reminderRows.length} reminders`)
  }

  const applyOverrides = (subs: ParsedSub[]) =>
    subs
      .filter((s) => !hiddenNormNames.has(normalizeName(s.serviceName!)))
      .map((s) => {
        const norm = normalizeName(s.serviceName!)
        return {
          ...s,
          amount: amountOverrideMap.has(norm) ? amountOverrideMap.get(norm)! : s.amount,
        }
      })

  const filteredSubscriptions = applyOverrides(subscriptions)
  const filteredTrials = applyOverrides(trials)

  return NextResponse.json({
    subscriptions: filteredSubscriptions,
    trials: filteredTrials,
    total: filteredSubscriptions.length + filteredTrials.length,
  })
}
