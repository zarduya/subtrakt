import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "@/lib/supabase"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const SYSTEM_PROMPT = `You extract subscription data from email metadata. These emails were pre-filtered by a Gmail search for subscription-related keywords, so be generous: when in doubt, classify as a subscription.

Mark isSubscription: true for ANY recurring digital service — streaming (Netflix, Spotify, Disney+, Apple TV+, YouTube Premium), software/SaaS (Adobe, Notion, Slack, GitHub, Figma, Zoom, Dropbox, 1Password, Dashlane), cloud storage (Google One, iCloud, OneDrive), productivity tools, gaming subscriptions (Xbox Game Pass, PlayStation Plus, Nintendo Online), VPN services (NordVPN, ExpressVPN), news/media (Substack, Patreon, NYT), cloud hosting (AWS, GCP, Azure, Vercel, Cloudflare), domain or email hosting, and anything similar.

Mark isSubscription: false ONLY for clearly non-recurring emails: login codes/OTPs, password resets, package delivery notifications, or one-time physical product purchases with no mention of recurring billing.

Set isTrial: true only if the email explicitly says "free trial", "trial period", "trial ends", or "trial expir".

Reply with ONLY valid JSON — no markdown fences, no explanation:
{
  "isSubscription": true or false,
  "isTrial": true or false,
  "serviceName": "name of the service",
  "amount": null or number (no currency symbol),
  "currency": null or ISO 4217 code like "USD" / "GBP" / "EUR" / "INR",
  "billingCycle": "monthly" or "annual" or "unknown",
  "renewalDate": null or "YYYY-MM-DD",
  "status": "active" or "cancelled" or "unknown"
}`

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const accessToken = session.accessToken
  if (!accessToken) return NextResponse.json({ error: "No access token" }, { status: 401 })

  const query = [
    "subject:(subscription OR billing OR renewal OR receipt OR payment OR invoice OR \"free trial\" OR \"trial ends\" OR \"auto-renew\" OR \"your plan\" OR \"plan renewal\" OR membership OR charged OR \"your account\")",
    "-subject:(OTP OR \"one-time password\" OR \"verification code\" OR \"sign-in code\" OR \"login code\" OR \"password reset\" OR shipment OR delivered OR tracking)",
  ].join(" ")

  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const searchData = await searchRes.json()
  console.log("[scan] Gmail search returned", searchData.messages?.length ?? 0, "messages")
  if (!searchData.messages || searchData.messages.length === 0) {
    return NextResponse.json({ subscriptions: [], trials: [], total: 0 })
  }

  const emails = await Promise.all(
    searchData.messages.map(async (msg: { id: string }) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const msgData = await msgRes.json()
      const headers: { name: string; value: string }[] = msgData.payload?.headers || []
      const subject = headers.find((h) => h.name === "Subject")?.value || "No subject"
      const from = headers.find((h) => h.name === "From")?.value || "Unknown"
      const date = headers.find((h) => h.name === "Date")?.value || ""
      console.log(`[scan] email: from="${from}" subject="${subject}"`)
      return { id: msg.id, subject, from, date }
    })
  )

  const results = await Promise.all(
    emails.map(async (email) => {
      try {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Subject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}` }],
        })
        const text = message.content[0].type === "text" ? message.content[0].text : ""
        const cleaned = text.replace(/```json\n?|```/g, "").trim()
        const parsed = JSON.parse(cleaned)
        console.log(`[scan] claude result for "${email.subject}":`, JSON.stringify(parsed))
        return { ...parsed, emailId: email.id, from: email.from, subject: email.subject, date: email.date }
      } catch (err) {
        console.error(`[scan] claude error for "${email.subject}":`, err)
        return { isSubscription: false, emailId: email.id }
      }
    })
  )

  const allSubs = results.filter((s) => s.isSubscription)

  // Deduplicate by service name — keep the most recent email per service
  const seen = new Map<string, typeof allSubs[0]>()
  for (const sub of allSubs) {
    const key = (sub.serviceName || "").toLowerCase().trim()
    if (!key) continue
    if (!seen.has(key)) {
      seen.set(key, sub)
    } else {
      const existingTime = new Date(seen.get(key)!.date || 0).getTime()
      const newTime = new Date(sub.date || 0).getTime()
      if (newTime > existingTime) seen.set(key, sub)
    }
  }
  const deduped = Array.from(seen.values())

  const trials = deduped.filter((s) => s.isTrial)
  const subscriptions = deduped.filter((s) => !s.isTrial)

  // Persist to Supabase — replace existing rows for this user
  const userEmail = session.user!.email!
  console.log(`[scan] saving ${deduped.length} subscriptions to Supabase for ${userEmail}`)

  const { error: deleteErr } = await supabase.from("subscriptions").delete().eq("user_email", userEmail)
  if (deleteErr) console.error("[scan] supabase delete error:", deleteErr)

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
        is_trial: sub.isTrial,
      }))
    )
    if (insertErr) console.error("[scan] supabase insert error:", insertErr)
    else console.log(`[scan] inserted ${deduped.length} rows successfully`)
  }

  // Create renewal reminders (7-day and 1-day) for subscriptions with a known renewal date
  const withDate = deduped.filter((s) => s.renewalDate)
  if (withDate.length > 0) {
    await supabase.from("reminders").delete().eq("user_email", userEmail)
    const reminderRows = withDate.flatMap((sub) => {
      const renewal = new Date(sub.renewalDate!)
      const sevenDay = new Date(renewal)
      sevenDay.setDate(sevenDay.getDate() - 7)
      const oneDay = new Date(renewal)
      oneDay.setDate(oneDay.getDate() - 1)
      return [
        { user_email: userEmail, service_name: sub.serviceName, renewal_date: sub.renewalDate, remind_at: sevenDay.toISOString().split("T")[0], sent: false },
        { user_email: userEmail, service_name: sub.serviceName, renewal_date: sub.renewalDate, remind_at: oneDay.toISOString().split("T")[0], sent: false },
      ]
    })
    const { error: remindErr } = await supabase.from("reminders").insert(reminderRows)
    if (remindErr) console.error("[scan] supabase reminders insert error:", remindErr)
    else console.log(`[scan] created ${reminderRows.length} reminders`)
  }

  return NextResponse.json({ subscriptions, trials, total: deduped.length })
}
