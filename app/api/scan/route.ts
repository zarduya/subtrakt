import { getServerSession } from "next-auth"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }

  const accessToken = (session as any).accessToken

  // Search Gmail with keyword filter
  const query = "subject:(subscription OR receipt OR invoice OR trial OR billing OR renewal)"
  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  const searchData = await searchRes.json()

  if (!searchData.messages) {
    return NextResponse.json({ emails: [], total: 0 })
  }

  // Fetch subject and sender for each email
  const emails = await Promise.all(
    searchData.messages.map(async (msg: any) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
      const msgData = await msgRes.json()
      const headers = msgData.payload?.headers || []
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "No subject"
      const from = headers.find((h: any) => h.name === "From")?.value || "Unknown"

      return { id: msg.id, subject, from }
    })
  )

  return NextResponse.json({ emails, total: emails.length })
}