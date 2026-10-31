import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const [subsResult, overridesResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("*")
      .eq("user_email", session.user.email)
      .order("created_at", { ascending: false }),
    supabase
      .from("user_overrides")
      .select("service_name, action, custom_amount")
      .eq("user_email", session.user.email),
  ])

  if (subsResult.error) return NextResponse.json({ error: subsResult.error.message }, { status: 500 })

  const overrides = overridesResult.data ?? []
  const hiddenNames = new Set<string>(
    overrides
      .filter((o: { action: string }) => o.action === "not_subscription" || o.action === "free")
      .map((o: { service_name: string }) => o.service_name)
  )
  const amountOverrides = new Map<string, number>(
    overrides
      .filter((o: { action: string; custom_amount: number | null }) => o.action === "edit_amount" && o.custom_amount != null)
      .map((o: { service_name: string; custom_amount: number }) => [o.service_name, o.custom_amount])
  )

  const mapped = (subsResult.data ?? [])
    .filter((row: { service_name: string }) => !hiddenNames.has(row.service_name))
    .map((row: {
      id: string | number
      service_name: string
      amount: number | null
      currency: string | null
      billing_cycle: string | null
      renewal_date: string | null
      status: string
      is_trial: boolean
      from_email: string | null
      subject: string | null
    }) => ({
      emailId: String(row.id),
      serviceName: row.service_name,
      amount: amountOverrides.has(row.service_name) ? amountOverrides.get(row.service_name)! : row.amount,
      currency: row.currency,
      billingCycle: row.billing_cycle,
      renewalDate: row.renewal_date,
      status: row.status,
      isTrial: row.is_trial,
      from: row.from_email,
      subject: row.subject,
    }))

  const trials = mapped.filter((s) => s.isTrial)
  const subscriptions = mapped.filter((s) => !s.isTrial)

  return NextResponse.json({ subscriptions, trials, total: mapped.length })
}
