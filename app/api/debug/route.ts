import { getServerSession } from "next-auth"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session) {
    return NextResponse.json({ error: "Not signed in" })
  }

  const accessToken = (session as any).accessToken

  const query = "subject:(subscription OR receipt OR invoice OR trial OR billing OR renewal)"
  const searchRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=5`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  const searchData = await searchRes.json()

  return NextResponse.json({ 
    hasToken: !!accessToken,
    gmailResponse: searchData
  })
}