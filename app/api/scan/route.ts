import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { supabase } from "@/lib/supabase"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const PROMPT = `You analyze email metadata to identify ONLY recurring subscription billing emails from software/digital services.

INCLUDE (isSubscription: true):
- Software or app subscriptions (Netflix, Spotify, Adobe, Notion, Slack, GitHub, etc.)
- SaaS tool billing and renewal notices
- Cloud service subscriptions (AWS, Google Cloud, Azure, etc.)
- Streaming or digital service renewals
- Free trial notifications for any of the above

DO NOT INCLUDE (isSubscription: false):
- Bank statements, credit card statements, or financial account summaries
- Stock, crypto, or investment portfolio emails
- One-time product purchase receipts (physical goods, software licenses without recurring billing)
- Food delivery or restaurant orders (Uber Eats, DoorDash, Deliveroo, Just Eat)
- Cinema tickets, event tickets, or travel bookings
- Email verification codes, OTPs, or login security alerts
- Shipping, tracking, or delivery notifications
- News newsletters or marketing emails that don't represent a subscription charge
- Social media notifications

Set isTrial to true ONLY if the email explicitly mentions words like "free trial", "trial period", "trial ends", "trial ending", or "trial expir".

Reply with ONLY valid JSON, no markdown, no explanation:
{
  "isSubscription": true or false,
  "isTrial": true or false,
  "serviceName": "exact name of the service or product",
  "amount": null or number (digits only, no currency symbol),
  "currency": null or "USD" or "GBP" or "EUR" or "INR" or other ISO 4217 code,
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
    "subject:(subscription OR billing OR renewal OR \"free trial\" OR \"trial ends\" OR \"auto-renew\" OR invoice OR \"your plan\" OR \"plan renewal\" OR \"membership\")",
    "-subject:(OTP OR \"one-time password\" OR \"verification code\" OR \"sign-in code\" OR \"login code\" OR \"password reset\" OR \"order confirmation\" OR \"your order\" OR shipment OR delivered OR ticket OR cinema)",
  ].join(" ")

  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=30`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const searchData = await searchRes.json()
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
      return { id: msg.id, subject, from, date }
    })
  )

  const results = await Promise.all(
    emails.map(async (email) => {
      try {
        const content = `${PROMPT}\n\nEmail subject: ${email.subject}\nFrom: ${email.from}\nDate: ${email.date}`
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content }],
        })
        const text = message.content[0].type === "text" ? message.content[0].text : ""
        const cleaned = text.replace(/```json|```/g, "").trim()
        const parsed = JSON.parse(cleaned)
        return { ...parsed, emailId: email.id, from: email.from, subject: email.subject, date: email.date }
      } catch {
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
  await supabase.from("subscriptions").delete().eq("user_email", userEmail)

  if (deduped.length > 0) {
    await supabase.from("subscriptions").insert(
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
  }

  // Create renewal reminders (7-day and 1-day) for subscriptions with a known renewal date
  const withDate = deduped.filter((s) => s.renewalDate)
  if (withDate.length > 0) {
    await supabase.from("reminders").delete().eq("user_email", userEmail)
    await supabase.from("reminders").insert(
      withDate.flatMap((sub) => {
        const renewal = new Date(sub.renewalDate!)
        const sevenDay = new Date(renewal)
        sevenDay.setDate(sevenDay.getDate() - 7)
        const oneDay = new Date(renewal)
        oneDay.setDate(oneDay.getDate() - 1)
        return [
          { user_email: userEmail, service_name: sub.serviceName, remind_at: sevenDay.toISOString().split("T")[0] },
          { user_email: userEmail, service_name: sub.serviceName, remind_at: oneDay.toISOString().split("T")[0] },
        ]
      })
    )
  }

  return NextResponse.json({ subscriptions, trials, total: deduped.length })
}
