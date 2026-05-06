"use client"

import { useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

type Subscription = {
  emailId: string
  serviceName: string
  amount: number | null
  currency: string | null
  billingCycle: "monthly" | "annual" | "unknown"
  renewalDate: string | null
  status: string
  isTrial: boolean
  from: string
  subject: string
}

type ScanData = {
  subscriptions: Subscription[]
  trials: Subscription[]
  total: number
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", GBP: "£", EUR: "€", INR: "₹", CAD: "CA$", AUD: "A$", JPY: "¥",
}

function fmtAmount(amount: number | null, currency: string | null, cycle: string) {
  if (!amount) return null
  const sym = currency ? (CURRENCY_SYMBOLS[currency] ?? currency + " ") : ""
  const cycleTag = cycle === "monthly" ? "/mo" : cycle === "annual" ? "/yr" : ""
  return { display: `${sym}${amount.toFixed(2)}`, cycleTag }
}

function computeSpend(subs: Subscription[]) {
  const withAmt = subs.filter((s) => s.amount && s.status === "active")
  const currencies = withAmt.map((s) => s.currency).filter(Boolean) as string[]
  const freq = currencies.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c]: (acc[c] ?? 0) + 1 }), {})
  const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const mixed = new Set(currencies).size > 1
  const sym = dominant ? (CURRENCY_SYMBOLS[dominant] ?? dominant + " ") : "$"

  const monthly = withAmt.reduce((sum, s) => {
    const amt = s.billingCycle === "annual" ? s.amount! / 12 : s.amount!
    return sum + amt
  }, 0)
  const annual = withAmt.reduce((sum, s) => {
    const amt = s.billingCycle === "monthly" ? s.amount! * 12 : s.amount!
    return sum + amt
  }, 0)

  return { monthly, annual, sym, mixed, hasData: withAmt.length > 0 }
}

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [data, setData] = useState<ScanData>({ subscriptions: [], trials: [], total: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/")
  }, [status, router])

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/scan")
        .then((r) => r.json())
        .then((d) => {
          setData({ subscriptions: d.subscriptions ?? [], trials: d.trials ?? [], total: d.total ?? 0 })
          setLoading(false)
        })
    }
  }, [status])

  const { subscriptions, trials } = data
  const active = subscriptions.filter((s) => s.status === "active")
  const cancelled = subscriptions.filter((s) => s.status !== "active")
  const spend = computeSpend(active)

  if (status === "loading" || loading) {
    return (
      <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center text-white">
        <div className="text-center">
          <div className="w-14 h-14 border-2 border-[#00e5a0]/20 border-t-[#00e5a0] rounded-full animate-spin mx-auto mb-6" />
          <p className="font-syne font-bold text-lg mb-1">Scanning your Gmail...</p>
          <p className="text-[#8892a4] text-sm">Claude is reading your subscription emails</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] text-white">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 flex items-center justify-between px-6 md:px-10 py-4 border-b border-white/[0.06] bg-[#0a0e1a]/90 backdrop-blur-md">
        <div className="font-syne font-extrabold text-xl tracking-tight">
          Sub<span className="text-[#00e5a0]">trakt</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:block text-[#8892a4] text-sm">{session?.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="text-sm border border-white/[0.08] text-[#8892a4] px-4 py-2 rounded-lg hover:border-red-400/50 hover:text-red-400 transition-all duration-200"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="px-6 md:px-10 py-10 max-w-5xl mx-auto">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="font-syne font-bold text-3xl mb-1">Your Subscriptions</h1>
          <p className="text-[#8892a4] text-sm">Detected by Claude from your Gmail inbox</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <StatCard label="Detected" value={String(data.total)} />
          <StatCard label="Active" value={String(active.length)} green />
          <StatCard
            label="Monthly spend"
            value={spend.hasData ? `${spend.mixed ? "~" : ""}${spend.sym}${spend.monthly.toFixed(2)}` : "—"}
            sub="est. per month"
            green
          />
          <StatCard
            label="Annual spend"
            value={spend.hasData ? `${spend.mixed ? "~" : ""}${spend.sym}${spend.annual.toFixed(2)}` : "—"}
            sub="est. per year"
          />
        </div>

        {/* Trials */}
        {trials.length > 0 && (
          <Section
            dot="bg-amber-400"
            title="Trials ending soon"
            titleClass="text-amber-400"
            count={trials.length}
            badge="bg-amber-400/10 text-amber-400 border-amber-400/20"
          >
            {trials.map((sub) => (
              <SubCard key={sub.emailId} sub={sub} variant="trial" />
            ))}
          </Section>
        )}

        {/* Active */}
        {active.length > 0 && (
          <Section
            dot="bg-[#00e5a0]"
            title="Active"
            count={active.length}
            badge="bg-[#00e5a0]/10 text-[#00e5a0] border-[#00e5a0]/20"
          >
            {active.map((sub) => (
              <SubCard key={sub.emailId} sub={sub} variant="active" />
            ))}
          </Section>
        )}

        {/* Cancelled */}
        {cancelled.length > 0 && (
          <div className="opacity-50">
            <Section
              dot="bg-red-400/60"
              title="Cancelled"
              titleClass="text-[#8892a4]"
              count={cancelled.length}
              badge="bg-red-400/10 text-red-400 border-red-400/20"
            >
              {cancelled.map((sub) => (
                <SubCard key={sub.emailId} sub={sub} variant="cancelled" />
              ))}
            </Section>
          </div>
        )}

        {/* Empty state */}
        {data.total === 0 && (
          <div className="text-center py-24 text-[#8892a4]">
            <div className="text-5xl mb-5">📭</div>
            <p className="font-syne font-bold text-xl text-white mb-2">No subscriptions found</p>
            <p className="text-sm">No recurring subscription emails were detected in your inbox</p>
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, green, sub }: {
  label: string
  value: string
  green?: boolean
  sub?: string
}) {
  return (
    <div className={`rounded-2xl p-5 border bg-[#0d1120] ${green ? "border-[#00e5a0]/20" : "border-white/[0.06]"}`}>
      <div className="text-[11px] text-[#8892a4] uppercase tracking-widest mb-2">{label}</div>
      <div className={`font-syne font-extrabold text-2xl leading-none ${green ? "text-[#00e5a0]" : "text-white"}`}>
        {value}
      </div>
      {sub && <div className="text-[#8892a4] text-[11px] mt-1">{sub}</div>}
    </div>
  )
}

function Section({ dot, title, titleClass, count, badge, children }: {
  dot: string
  title: string
  titleClass?: string
  count: number
  badge: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${dot}`} />
        <h2 className={`font-syne font-bold text-sm ${titleClass ?? "text-white"}`}>{title}</h2>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${badge}`}>{count}</span>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function SubCard({ sub, variant }: { sub: Subscription; variant: "active" | "trial" | "cancelled" }) {
  const formatted = fmtAmount(sub.amount, sub.currency, sub.billingCycle)

  const borderClass =
    variant === "trial"
      ? "border-amber-400/20 hover:border-amber-400/40 hover:shadow-[0_4px_24px_rgba(251,191,36,0.08)]"
      : variant === "active"
      ? "border-white/[0.06] hover:border-[#00e5a0]/30 hover:shadow-[0_4px_24px_rgba(0,229,160,0.06)]"
      : "border-white/[0.06] hover:border-white/10"

  return (
    <div
      className={`bg-[#0d1120] border rounded-2xl p-5 hover:-translate-y-px transition-all duration-200 cursor-default ${borderClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-syne font-semibold text-base leading-none">{sub.serviceName}</span>
            {variant === "trial" && (
              <span className="text-[11px] bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2 py-0.5 rounded-full">
                Trial
              </span>
            )}
            {sub.billingCycle !== "unknown" && (
              <span className="text-[11px] bg-white/[0.04] text-[#8892a4] border border-white/[0.06] px-2 py-0.5 rounded-full capitalize">
                {sub.billingCycle}
              </span>
            )}
          </div>
          <div className="text-[#8892a4] text-xs truncate mt-1">{sub.from}</div>
        </div>
        <div className="text-right flex-shrink-0">
          {formatted ? (
            <div className="font-syne font-bold text-base leading-none">
              {formatted.display}
              <span className="text-[#8892a4] text-xs font-normal">{formatted.cycleTag}</span>
            </div>
          ) : null}
          {sub.renewalDate && (
            <div className="text-[#8892a4] text-xs mt-1">Renews {sub.renewalDate}</div>
          )}
        </div>
      </div>
    </div>
  )
}
