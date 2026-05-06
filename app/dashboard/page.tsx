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

const SYM: Record<string, string> = {
  USD: "$", GBP: "£", EUR: "€", INR: "₹", CAD: "CA$", AUD: "A$", JPY: "¥",
}

const STATUS_COLOR: Record<string, string> = {
  active: "#22c55e",
  cancelled: "#ef4444",
  trial: "#e8ff47",
}

function extractRootDomain(from: string): string {
  const host = from.match(/@([\w.-]+)/)?.[1] ?? ""
  const parts = host.split(".")
  return parts.length > 2 ? parts.slice(-2).join(".") : host
}

function currencyOf(subs: Subscription[]) {
  const counts: Record<string, number> = {}
  for (const s of subs) {
    if (s.currency) counts[s.currency] = (counts[s.currency] ?? 0) + 1
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { sym: top ? (SYM[top] ?? top + " ") : "", mixed: new Set(Object.keys(counts)).size > 1 }
}

function calcSpend(subs: Subscription[]) {
  const billable = subs.filter((s) => s.amount && s.status === "active")
  const { sym, mixed } = currencyOf(billable)
  const monthly = billable.reduce(
    (acc, s) => acc + (s.billingCycle === "annual" ? s.amount! / 12 : s.amount!),
    0
  )
  const annual = billable.reduce(
    (acc, s) => acc + (s.billingCycle === "monthly" ? s.amount! * 12 : s.amount!),
    0
  )
  return { sym, mixed, monthly, annual, any: billable.length > 0 }
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ email }: { email?: string | null }) {
  return (
    <aside className="w-[220px] shrink-0 sticky top-0 h-screen flex flex-col border-r border-[#1c1c1e] bg-[#09090b]">
      {/* Logo */}
      <div className="px-6 py-[22px] border-b border-[#1c1c1e]">
        <span className="font-space font-semibold text-[15px] tracking-tight text-[#fafafa]">Subtrakt</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 pt-4">
        <div className="flex items-center gap-2.5 px-3 py-[9px] rounded-lg bg-[#111113] text-[#fafafa] text-[13px] font-medium">
          {/* Grid icon */}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
            <rect x="7.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="0.5" y="7.5" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="7.5" y="7.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
          </svg>
          Overview
        </div>
      </nav>

      {/* User / sign out */}
      <div className="p-3 border-t border-[#1c1c1e]">
        {email && (
          <div className="px-3 py-1 text-[11px] text-[#52525b] truncate mb-1">{email}</div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full flex items-center gap-2 px-3 py-[7px] rounded-lg text-[13px] text-[#71717a] hover:text-[#fafafa] hover:bg-[#111113] transition-colors duration-150 text-left"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}

// ─── Stat block ─────────────────────────────────────────────────────────────

function StatBlock({
  value,
  unit,
  label,
  noUnit,
}: {
  value: string
  unit: string
  label: string
  noUnit?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 px-10 first:pl-0">
      <div className="flex items-baseline gap-1.5 leading-none">
        <span className="font-space font-semibold text-[3.75rem] tracking-tight text-[#fafafa] tabular-nums leading-none">
          {value}
        </span>
        {!noUnit && (
          <span className="text-[13px] text-[#52525b] font-light pb-1">{unit}</span>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#52525b]">{label}</div>
    </div>
  )
}

function StatDivider() {
  return <div className="w-px h-12 bg-[#1c1c1e] self-center shrink-0" />
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function SubSection({
  title,
  count,
  dot,
  children,
}: {
  title: string
  count: number
  dot: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-3">
        <span
          className="w-[7px] h-[7px] rounded-full shrink-0"
          style={{ background: dot }}
        />
        <h2 className="font-space font-medium text-[13px] text-[#fafafa]">{title}</h2>
        <span className="text-[12px] text-[#52525b] ml-0.5">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

// ─── Subscription card ───────────────────────────────────────────────────────

function SubCard({ sub, leftColor }: { sub: Subscription; leftColor: string }) {
  const domain = extractRootDomain(sub.from)
  const sym = sub.currency ? (SYM[sub.currency] ?? sub.currency + " ") : ""
  const cycleTag = sub.billingCycle === "monthly" ? "/mo" : sub.billingCycle === "annual" ? "/yr" : ""

  return (
    <div
      className="
        flex items-center justify-between gap-4
        bg-[#111113] border border-[#1c1c1e] border-l-2 rounded-xl
        px-5 py-4
        hover:bg-[#131315]
        hover:shadow-[0_2px_16px_rgba(0,0,0,0.55)]
        transition-all duration-150 cursor-default
      "
      style={{ borderLeftColor: leftColor }}
    >
      {/* Left: favicon + info */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[#1c1c1e] flex items-center justify-center overflow-hidden shrink-0">
          {domain ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
              alt=""
              width={28}
              height={28}
              className="rounded-sm object-contain"
              onError={(e) => { e.currentTarget.style.display = "none" }}
            />
          ) : null}
        </div>

        <div className="min-w-0">
          <div className="font-space font-medium text-[#fafafa] text-[14px] leading-none mb-1 truncate">
            {sub.serviceName}
          </div>
          <div className="text-[11px] text-[#52525b] truncate">
            {sub.billingCycle !== "unknown"
              ? `Billed ${sub.billingCycle}`
              : "Frequency unknown"}
            {sub.renewalDate ? ` · Renews ${sub.renewalDate}` : ""}
          </div>
        </div>
      </div>

      {/* Right: amount */}
      <div className="shrink-0 text-right">
        {sub.amount ? (
          <div className="font-space font-medium text-[14px] text-[#fafafa] leading-none">
            {sym}{sub.amount.toFixed(2)}
            <span className="text-[#52525b] text-[11px] font-normal">{cycleTag}</span>
          </div>
        ) : (
          <div className="text-[11px] text-[#52525b]">—</div>
        )}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

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
        .then((d: Partial<ScanData>) => {
          setData({
            subscriptions: d.subscriptions ?? [],
            trials: d.trials ?? [],
            total: d.total ?? 0,
          })
          setLoading(false)
        })
    }
  }, [status])

  const { subscriptions, trials } = data
  const active = subscriptions.filter((s) => s.status === "active")
  const cancelled = subscriptions.filter((s) => s.status !== "active")
  const spend = calcSpend(active)
  const pfx = spend.mixed ? "~" : ""

  return (
    <div className="flex min-h-screen bg-[#09090b] text-[#fafafa]">
      <Sidebar email={session?.user?.email} />

      {/* Main */}
      <div className="flex-1 overflow-auto">
        {/* Page header */}
        <div className="px-10 pt-10 pb-8 border-b border-[#1c1c1e]">
          <h1 className="font-space font-semibold text-[22px] text-[#fafafa] leading-none mb-1">
            Overview
          </h1>
          <p className="text-[13px] text-[#71717a]">Detected from your Gmail by Claude</p>
        </div>

        <div className="px-10 py-10 max-w-4xl">
          {status === "loading" || loading ? (
            /* Loading state */
            <div className="flex items-center gap-3 text-[#71717a] py-4">
              <div className="w-4 h-4 border border-[#71717a] border-t-[#fafafa] rounded-full animate-spin" />
              <span className="text-[13px]">Scanning your inbox with Claude...</span>
            </div>
          ) : (
            <>
              {/* ── Stats ── */}
              <div className="flex items-start flex-wrap gap-y-8 mb-14 border-b border-[#1c1c1e] pb-12">
                <StatBlock value={String(data.total)} unit="found" label="subscriptions" />
                <StatDivider />
                <StatBlock
                  value={spend.any ? `${pfx}${spend.sym}${spend.monthly.toFixed(2)}` : "—"}
                  unit="/month"
                  label="est. monthly spend"
                  noUnit={!spend.any}
                />
                <StatDivider />
                <StatBlock
                  value={spend.any ? `${pfx}${spend.sym}${spend.annual.toFixed(2)}` : "—"}
                  unit="/year"
                  label="est. annual spend"
                  noUnit={!spend.any}
                />
              </div>

              {/* ── Trials ── */}
              {trials.length > 0 && (
                <SubSection title="Trials ending soon" count={trials.length} dot={STATUS_COLOR.trial}>
                  {trials.map((s) => (
                    <SubCard key={s.emailId} sub={s} leftColor={STATUS_COLOR.trial} />
                  ))}
                </SubSection>
              )}

              {/* ── Active ── */}
              {active.length > 0 && (
                <SubSection title="Active" count={active.length} dot={STATUS_COLOR.active}>
                  {active.map((s) => (
                    <SubCard key={s.emailId} sub={s} leftColor={STATUS_COLOR.active} />
                  ))}
                </SubSection>
              )}

              {/* ── Cancelled ── */}
              {cancelled.length > 0 && (
                <SubSection title="Cancelled" count={cancelled.length} dot={STATUS_COLOR.cancelled}>
                  {cancelled.map((s) => (
                    <SubCard key={s.emailId} sub={s} leftColor={STATUS_COLOR.cancelled} />
                  ))}
                </SubSection>
              )}

              {/* ── Empty state ── */}
              {data.total === 0 && (
                <div className="py-20 text-center">
                  <div
                    className="text-5xl mb-5 opacity-10 font-space font-semibold select-none"
                    aria-hidden="true"
                  >
                    ◎
                  </div>
                  <p className="font-space font-medium text-[17px] text-[#fafafa] mb-1">
                    Nothing detected
                  </p>
                  <p className="text-[13px] text-[#71717a]">
                    No recurring subscription emails were found in your inbox
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
