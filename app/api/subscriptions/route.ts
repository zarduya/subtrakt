import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { normalizeName } from "@/lib/normalize"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const userEmail = session.user.email

  // Find the most recent scan timestamp so we return only the latest batch.
  // This prevents duplicate rows during the brief atomic-swap window.
  const { data: latestBatch } = await supabase
    .from("subscriptions")
    .select("scanned_at")
    .eq("user_email", userEmail)
    .order("scanned_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestBatch?.scanned_at) {
    return NextResponse.json({ subscriptions: [], trials: [], total: 0 })
  }

  const [subsResult, overridesResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("*")
      .eq("user_email", userEmail)
      .eq("scanned_at", latestBatch.scanned_at),
    supabase
      .from("user_overrides")
      .select("service_name, action, custom_amount")
      .eq("user_email", userEmail),
  ])

  if (subsResult.error) return NextResponse.json({ error: subsResult.error.message }, { status: 500 })

  // Build override lookups keyed on the NORMALISED service name so overrides
  // survive rescans even when Claude returns a slightly different capitalisation.
  const overrides = overridesResult.data ?? []
  const hiddenNormNames = new Set<string>(
    overrides
      .filter((o: { action: string }) => o.action === "not_subscription" || o.action === "free")
      .map((o: { service_name: string }) => normalizeName(o.service_name))
  )
  const amountOverridesByNorm = new Map<string, number>(
    overrides
      .filter((o: { action: string; custom_amount: number | null }) => o.action === "edit_amount" && o.custom_amount != null)
      .map((o: { service_name: string; custom_amount: number }) => [normalizeName(o.service_name), o.custom_amount])
  )

  const mapped = (subsResult.data ?? [])
    .filter((row: { service_name: string }) => !hiddenNormNames.has(normalizeName(row.service_name)))
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
    }) => {
      const norm = normalizeName(row.service_name)
      return {
        emailId: String(row.id),
        serviceName: row.service_name,
        amount: amountOverridesByNorm.has(norm) ? amountOverridesByNorm.get(norm)! : row.amount,
        currency: row.currency,
        billingCycle: row.billing_cycle,
        renewalDate: row.renewal_date,
        status: row.status,
        isTrial: row.is_trial,
        from: row.from_email,
        subject: row.subject,
      }
    })

  const trials = mapped.filter((s) => s.isTrial)
  const subscriptions = mapped.filter((s) => !s.isTrial)

  return NextResponse.json({ subscriptions, trials, total: mapped.length })
}
