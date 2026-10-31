import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "@/lib/supabase"

export const maxDuration = 60

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract subscription information from email content.

Rules:
- Mark isSubscription: true for ANY recurring digital service (streaming, SaaS, cloud storage, gaming subscriptions, VPN, news/media, hosting, etc.)
- Mark isSubscription: false ONLY for: login codes/OTPs, password resets, package delivery/shipping, one-time purchases with no recurring billing
- Normalize serviceName to brand only: "Udemy Personal Plan" → "Udemy", "Google One 100GB" → "Google One", "Netflix Standard with Ads" → "Netflix"
- status: "active" if charged/renewed/active subscription, "cancelled" if cancellation confirmed, "trial" if in a free trial, "unknown" if unclear
- amount: extract the numeric amount only (no currency symbol), null if not mentioned
- currency: ISO 4217 code (USD, GBP, EUR, INR, etc.) or null if not mentioned
- billingCycle: "monthly", "yearly", "weekly", or null if not determinable
- renewalDate: "YYYY-MM-DD" or null — resolve relative dates like "renews in 7 days" using the receivedDate provided
- lastChargeDate: "YYYY-MM-DD" or null — the date the most recent charge occurred
- isTrial: true only if email explicitly mentions free trial, trial period, trial ends, or trial expiry
- trialEndDate: "YYYY-MM-DD" or null

Reply with ONLY valid JSON, no markdown fences, no explanation:
{"isSubscription":true,"serviceName":"...","status":"active","amount":null,"currency":null,"billingCycle":null,"renewalDate":null,"lastChargeDate":null,"isTrial":false,"trialEndDate":null}`

// ─── Alias map: normalized name → canonical group key ────────────────────────
const ALIAS_MAP: Record<string, string> = {
  anthropic: "claude",
}

const STRIP_SUFFIXES_RE = /\b(ai|vpn|pro|plus|premium|subscription|membership|app)\b/gi
const STRIP_PUNCT_RE = /[^\w\s]/g

function normalizeName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(STRIP_PUNCT_RE, " ")
    .replace(STRIP_SUFFIXES_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
  return ALIAS_MAP[n] ?? n
}

function senderDomain(from: string): string {
  const host = from.match(/@([\w.-]+)/)?.[1]?.toLowerCase() ?? ""
  const parts = host.split(".")
  if (parts.length < 2) return host
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

  // ─── Deduplicate by normalized name OR sender domain ──────────────────────
  const nameKeyToCanonical = new Map<string, string>()
  const domainToCanonical = new Map<string, string>()
  const groups = new Map<string, ParsedSub[]>()

  for (const sub of allSubs) {
    const nameKey = normalizeName(sub.serviceName || "")
    if (!nameKey) continue
    const domain = senderDomain(sub.from || "")

    const canonical =
      ALIAS_MAP[nameKey] ??
      nameKeyToCanonical.get(nameKey) ??
      (domain ? domainToCanonical.get(domain) : undefined) ??
      nameKey

    if (!nameKeyToCanonical.has(nameKey)) nameKeyToCanonical.set(nameKey, canonical)
    if (domain && !domainToCanonical.has(domain)) domainToCanonical.set(domain, canonical)
    if (!groups.has(canonical)) groups.set(canonical, [])
    groups.get(canonical)!.push(sub)
  }

  const todayStr = todayUTC().toISOString().split("T")[0]

  const rawDeduped: ParsedSub[] = []
  for (const [, group] of groups) {
    group.sort((a, b) => parseInt(b.internalDate || "0") - parseInt(a.internalDate || "0"))
    const newest = group[0]

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

    rawDeduped.push({ ...newest, amount, currency, billingCycle, renewalDate, lastChargeDate, trialEndDate, status })
  }

  // ─── Handle past trials ──────────────────────────────────────────────────
  const deduped: ParsedSub[] = []
  for (const sub of rawDeduped) {
    if (sub.isTrial && sub.trialEndDate && sub.trialEndDate < todayStr) {
      const hasLaterCharge = !!(sub.lastChargeDate && sub.lastChargeDate > sub.trialEndDate!)
      const hasEvidence = hasLaterCharge || !!sub.billingCycle
      if (hasEvidence) {
        // Promote to active subscription
        const base = sub.lastChargeDate ?? sub.trialEndDate!
        const renewal = sub.billingCycle ? rollDateForward(base, sub.billingCycle) : null
        deduped.push({ ...sub, isTrial: false, status: "active", renewalDate: renewal })
      }
      // else: drop the expired trial entirely
    } else {
      deduped.push(sub)
    }
  }

  console.log("[scan] final deduplicated list:", JSON.stringify(deduped.map((s) => ({ serviceName: s.serviceName, status: s.status, renewalDate: s.renewalDate, amount: s.amount, currency: s.currency }))))

  const trials = deduped.filter((s) => s.isTrial)
  const subscriptions = deduped.filter((s) => !s.isTrial)

  // ─── Persist to Supabase ─────────────────────────────────────────────────
  const userEmail = session.user!.email!
  console.log(`[scan] saving ${deduped.length} subscriptions to Supabase for ${userEmail}`)

  const { error: deleteErr } = await supabase.from("subscriptions").delete().eq("user_email", userEmail)
  if (deleteErr) console.error("[scan] supabase delete error:", JSON.stringify(deleteErr))

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
      }))
    )
    if (insertErr) console.error("[scan] supabase insert error:", JSON.stringify(insertErr))
    else console.log(`[scan] inserted ${deduped.length} rows successfully`)
  }

  // ─── Reminders — future dates only, skip cancelled ───────────────────────
  const { error: delRemindErr } = await supabase.from("reminders").delete().eq("user_email", userEmail)
  if (delRemindErr) console.error("[scan] supabase reminders delete error:", JSON.stringify(delRemindErr))

  const reminderCandidates = deduped.filter((s) => s.renewalDate && s.status !== "cancelled")
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

  return NextResponse.json({ subscriptions, trials, total: deduped.length })
}
