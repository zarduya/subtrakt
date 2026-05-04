import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const accessToken = (session as any).accessToken
  if (!accessToken) return NextResponse.json({ error: "No access token" }, { status: 401 })

  const query = "subject:(subscription OR receipt OR invoice OR trial OR billing OR renewal)"
  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const searchData = await searchRes.json()
  if (!searchData.messages || searchData.messages.length === 0) {
    return NextResponse.json({ subscriptions: [], total: 0 })
  }

  const emails = await Promise.all(
    searchData.messages.map(async (msg: any) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const msgData = await msgRes.json()
      const headers = msgData.payload?.headers || []
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "No subject"
      const from = headers.find((h: any) => h.name === "From")?.value || "Unknown"
      const date = headers.find((h: any) => h.name === "Date")?.value || ""
      return { id: msg.id, subject, from, date }
    })
  )

  const subscriptions = await Promise.all(
    emails.map(async (email) => {
      try {
        const message = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{
            role: "user",
            content: "Analyze this email and extract subscription info. Reply with ONLY a JSON object, no markdown, no explanation.\n\nEmail subject: " + email.subject + "\nFrom: " + email.from + "\nDate: " + email.date + "\n\nJSON format:\n{\n  \"isSubscription\": true or false,\n  \"serviceName\": \"name of the service\",\n  \"amount\": null or number,\n  \"currency\": \"GBP or USD or INR etc\",\n  \"renewalDate\": null or \"YYYY-MM-DD\",\n  \"status\": \"active or cancelled or unknown\"\n}"
          }]
        })
        const text = message.content[0].type === "text" ? message.content[0].text : ""
        const cleaned = text.replace(/```json|```/g, "").trim()
        const parsed = JSON.parse(cleaned)
        return { ...parsed, emailId: email.id, from: email.from, subject: email.subject }
      } catch (e) {
        return { isSubscription: false, emailId: email.id, subject: email.subject }
      }
    })
  )

  const filtered = subscriptions.filter((s) => s.isSubscription)
  return NextResponse.json({ subscriptions: filtered, total: filtered.length })
}
