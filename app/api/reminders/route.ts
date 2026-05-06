import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/options"
import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: "Not signed in" }, { status: 401 })

  const userEmail = session.user.email

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("service_name, renewal_date")
    .eq("user_email", userEmail)
    .not("renewal_date", "is", null)

  if (!subs || subs.length === 0) return NextResponse.json({ created: 0 })

  await supabase.from("reminders").delete().eq("user_email", userEmail)

  const rows = subs.flatMap((sub) => {
    const renewal = new Date(sub.renewal_date)
    const sevenDay = new Date(renewal)
    sevenDay.setDate(sevenDay.getDate() - 7)
    const oneDay = new Date(renewal)
    oneDay.setDate(oneDay.getDate() - 1)
    return [
      { user_email: userEmail, service_name: sub.service_name, remind_at: sevenDay.toISOString().split("T")[0] },
      { user_email: userEmail, service_name: sub.service_name, remind_at: oneDay.toISOString().split("T")[0] },
    ]
  })

  await supabase.from("reminders").insert(rows)

  return NextResponse.json({ created: rows.length })
}
