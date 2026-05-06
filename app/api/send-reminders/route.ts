import { NextResponse } from "next/server"
import { Resend } from "resend"
import { supabase } from "@/lib/supabase"

const resend = new Resend(process.env.RESEND_API_KEY)

function emailHtml(serviceName: string, renewalDate: string, daysUntil: number): string {
  const urgencyLine =
    daysUntil <= 0
      ? "renews <strong style='color:#ef4444'>today</strong>"
      : daysUntil === 1
        ? "renews <strong style='color:#e8ff47'>tomorrow</strong>"
        : `renews in <strong style='color:#e8ff47'>${daysUntil} days</strong>`

  const formatted = new Date(renewalDate + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${serviceName} renewal reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#09090b;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table width="540" cellpadding="0" cellspacing="0" role="presentation" style="max-width:540px;width:100%;">

          <!-- Logo -->
          <tr>
            <td style="padding:0 0 28px 0;">
              <span style="font-size:15px;font-weight:600;letter-spacing:-0.03em;color:#fafafa;">Subtrakt</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#111113;border:1px solid #1c1c1e;border-radius:12px;padding:36px 36px 32px;">

              <!-- Icon + heading -->
              <p style="margin:0 0 20px 0;font-size:26px;line-height:1;">⚠️</p>
              <h1 style="margin:0 0 6px 0;font-size:20px;font-weight:600;letter-spacing:-0.03em;color:#fafafa;line-height:1.3;">
                ${serviceName} ${urgencyLine}
              </h1>
              <p style="margin:0 0 28px 0;font-size:14px;color:#71717a;line-height:1.6;">
                Renewal date: <span style="color:#fafafa;">${formatted}</span>
              </p>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr><td style="border-top:1px solid #1c1c1e;padding:0 0 24px 0;font-size:0;">&nbsp;</td></tr>
              </table>

              <!-- Body copy -->
              <p style="margin:0 0 20px 0;font-size:14px;color:#a1a1aa;line-height:1.7;">
                If you want to cancel or downgrade <strong style="color:#fafafa;">${serviceName}</strong>, do it before the renewal date — most services won't refund you after they charge.
              </p>

              <!-- Footer note -->
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
                You're getting this because Subtrakt found a renewal date in your inbox.<br>
                No more reminders will be sent for this cycle.
              </p>

            </td>
          </tr>

          <!-- Email footer -->
          <tr>
            <td style="padding:24px 0 0 0;">
              <p style="margin:0;font-size:11px;color:#3f3f46;letter-spacing:0.02em;">
                SUBTRAKT &nbsp;·&nbsp; Subscription tracker
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function GET() {
  const today = new Date().toISOString().split("T")[0]

  const { data: reminders, error: fetchErr } = await supabase
    .from("reminders")
    .select("id, user_email, service_name, renewal_date, remind_at")
    .eq("sent", false)
    .lte("remind_at", today)

  if (fetchErr) {
    console.error("[send-reminders] fetch error:", fetchErr)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!reminders?.length) {
    console.log("[send-reminders] no pending reminders")
    return NextResponse.json({ sent: 0 })
  }

  console.log(`[send-reminders] processing ${reminders.length} reminders`)

  let sent = 0
  const errors: string[] = []

  for (const reminder of reminders) {
    const daysUntil = Math.ceil(
      (new Date(reminder.renewal_date + "T12:00:00Z").getTime() - Date.now()) / 86_400_000
    )

    try {
      const { error: emailErr } = await resend.emails.send({
        from: "Subtrakt <onboarding@resend.dev>",
        to: reminder.user_email,
        subject: `⚠️ ${reminder.service_name} renews soon — cancel before it hits your card`,
        html: emailHtml(reminder.service_name, reminder.renewal_date, daysUntil),
      })

      if (emailErr) throw emailErr

      const { error: updateErr } = await supabase
        .from("reminders")
        .update({ sent: true })
        .eq("id", reminder.id)

      if (updateErr) console.error(`[send-reminders] failed to mark sent for id=${reminder.id}:`, updateErr)

      sent++
      console.log(`[send-reminders] sent to ${reminder.user_email} for ${reminder.service_name}`)
    } catch (err) {
      const msg = `${reminder.user_email}/${reminder.service_name}: ${err}`
      console.error("[send-reminders] email error:", msg)
      errors.push(msg)
    }
  }

  return NextResponse.json({ sent, total: reminders.length, ...(errors.length ? { errors } : {}) })
}
