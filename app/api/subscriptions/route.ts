import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_email", session.user.email)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const mapped = (data ?? []).map((row) => ({
    emailId: String(row.id),
    serviceName: row.service_name,
    amount: row.amount,
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
