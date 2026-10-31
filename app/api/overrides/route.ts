import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { normalizeName } from "@/lib/normalize"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const { data, error } = await supabase
    .from("user_overrides")
    .select("id, service_name, action, custom_amount, created_at")
    .eq("user_email", session.user.email)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const body = await req.json()
  const { service_name, action, custom_amount } = body as {
    service_name: string
    action: string
    custom_amount?: number | null
  }

  if (!service_name || !action) {
    return NextResponse.json({ error: "Missing service_name or action" }, { status: 400 })
  }

  // Store the normalised service name so overrides survive rescans where Claude
  // returns slightly different capitalisation or spacing.
  const normalizedName = normalizeName(service_name)

  const { error } = await supabase.from("user_overrides").upsert(
    {
      user_email: session.user.email,
      service_name: normalizedName,
      action,
      custom_amount: custom_amount ?? null,
    },
    { onConflict: "user_email,service_name" }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
