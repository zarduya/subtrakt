"use client"

import { useEffect, useRef, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

type OverrideAction = "not_subscription" | "free" | "edit_amount"

type Subscription = {
  emailId: string
  serviceName: string
  amount: number | null
  currency: string | null
  billingCycle: "monthly" | "yearly" | "weekly" | null
  renewalDate: string | null
  status: string
  isTrial: boolean
  from: string | null
  subject: string | null
}

type ScanData = {
  subscriptions: Subscription[]
  trials: Subscription[]
  total: number
}

const SYM: Record<string, string> = {
  USD: "$", GBP: "£", EUR: "€", INR: "₹", CAD: "CA$", AUD: "A$", JPY: "¥",
}

// Fixed rates to GBP for total spend display
const TO_GBP: Record<string, number> = {
  GBP: 1,
  USD: 0.79,
  EUR: 0.85,
  INR: 0.0095,
  CAD: 0.58,
  AUD: 0.51,
  JPY: 0.0052,
}

const STATUS_COLOR: Record<string, string> = {
  active: "#22c55e",
  cancelled: "#ef4444",
  trial: "#e8ff47",
  lapsed: "#52525b",
}

function toGBP(amount: number, currency: string | null): number {
  if (!currency) return amount
  return amount * (TO_GBP[currency] ?? 1)
}

// Service name → favicon domain. Covers services billed through marketplaces
// (App Store, Google Play, etc.) where the sender domain is wrong.
const SERVICE_DOMAIN_OVERRIDES: Record<string, string> = {
  "applecare": "apple.com",
  "apple tv": "apple.com",
  "apple arcade": "apple.com",
  "icloud": "icloud.com",
  "claude": "claude.ai",
  "anthropic": "anthropic.com",
  "github copilot": "github.com",
  "google one": "google.com",
  "google workspace": "google.com",
  "youtube": "youtube.com",
  "youtube music": "youtube.com",
  "google play": "play.google.com",
  "new york times": "nytimes.com",
  "new york times digital": "nytimes.com",
  "nyt": "nytimes.com",
  "nytimes": "nytimes.com",
}

const STRIP_FOR_DOMAIN_RE = /\b(vpn|pro|plus|premium|basic|standard|individual|family|personal|plan|subscription|membership|app|digital|news)\b/gi

function serviceNameToDomain(serviceName: string): string {
  const normalized = serviceName
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/^(the|an?)\s+/i, "")
    .replace(STRIP_FOR_DOMAIN_RE, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (SERVICE_DOMAIN_OVERRIDES[normalized]) return SERVICE_DOMAIN_OVERRIDES[normalized]

  const firstWord = normalized.split(" ")[0]
  if (firstWord && SERVICE_DOMAIN_OVERRIDES[firstWord]) return SERVICE_DOMAIN_OVERRIDES[firstWord]

  return firstWord ? `${firstWord}.com` : ""
}

function calcSpend(subs: Subscription[]) {
  // Exclude trials and cancelled from spend totals
  const billable = subs.filter((s) => s.amount != null && s.status === "active" && !s.isTrial)
  if (billable.length === 0) return { monthly: 0, annual: 0, any: false }

  const monthly = billable.reduce((acc, s) => {
    const gbp = toGBP(s.amount!, s.currency)
    if (s.billingCycle === "yearly") return acc + gbp / 12
    if (s.billingCycle === "weekly") return acc + gbp * 4.33
    return acc + gbp
  }, 0)

  const annual = billable.reduce((acc, s) => {
    const gbp = toGBP(s.amount!, s.currency)
    if (s.billingCycle === "monthly") return acc + gbp * 12
    if (s.billingCycle === "weekly") return acc + gbp * 52
    return acc + gbp
  }, 0)

  return { monthly, annual, any: true }
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ email }: { email?: string | null }) {
  return (
    <aside className="w-[220px] shrink-0 sticky top-0 h-screen flex flex-col border-r border-[#1c1c1e] bg-[#09090b]">
      <div className="px-6 py-[22px] border-b border-[#1c1c1e]">
        <span className="font-space font-semibold text-[15px] tracking-tight text-[#fafafa]">Subtrakt</span>
      </div>

      <nav className="flex-1 p-3 pt-4">
        <div className="flex items-center gap-2.5 px-3 py-[9px] rounded-lg bg-[#111113] text-[#fafafa] text-[13px] font-medium">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
            <rect x="0.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
            <rect x="7.5" y="0.5" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="0.5" y="7.5" width="5" height="5" rx="1" fill="currentColor" />
            <rect x="7.5" y="7.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
          </svg>
          Overview
        </div>
      </nav>

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
    <div className="flex flex-col gap-1">
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

// ─── Section wrapper ─────────────────────────────────────────────────────────

function SubSection({
  title,
  count,
  dot,
  children,
  defaultCollapsed,
}: {
  title: string
  count: number
  dot: string
  children: React.ReactNode
  defaultCollapsed?: boolean
}) {
  const [open, setOpen] = useState(defaultCollapsed === undefined ? true : !defaultCollapsed)
  const collapsible = defaultCollapsed !== undefined

  return (
    <section className="mb-10">
      <div
        role={collapsible ? "button" : undefined}
        tabIndex={collapsible ? 0 : undefined}
        className={`flex items-center gap-2 mb-3 ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        onKeyDown={collapsible ? (e) => { if (e.key === "Enter" || e.key === " ") setOpen((o) => !o) } : undefined}
      >
        <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} />
        <h2 className="font-space font-medium text-[13px] text-[#fafafa]">{title}</h2>
        <span className="text-[12px] text-[#52525b] ml-0.5">{count}</span>
        {collapsible && (
          <span
            className={`ml-auto text-[#52525b] text-[11px] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        )}
      </div>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  )
}

// ─── Subscription card ───────────────────────────────────────────────────────

function SubCard({
  sub,
  leftColor,
  onOverride,
}: {
  sub: Subscription
  leftColor: string
  onOverride: (action: OverrideAction, amount?: number) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(sub.amount != null ? sub.amount.toFixed(2) : "")
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  function submitEdit() {
    const v = parseFloat(editVal)
    if (!isNaN(v) && v >= 0) onOverride("edit_amount", v)
    setEditing(false)
  }

  const domain = serviceNameToDomain(sub.serviceName)
  const sym = sub.currency ? (SYM[sub.currency] ?? sub.currency + " ") : ""
  const cycleTag =
    sub.billingCycle === "monthly" ? "/mo" :
    sub.billingCycle === "yearly" ? "/yr" :
    sub.billingCycle === "weekly" ? "/wk" : ""

  const billingText = sub.billingCycle ? `Billed ${sub.billingCycle}` : null
  const renewalText = sub.status !== "cancelled" && sub.renewalDate
    ? ` · Renews ${sub.renewalDate}`
    : null
  const subText = [billingText, renewalText].filter(Boolean).join("") || null

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
          {subText && (
            <div className="text-[11px] text-[#52525b] truncate">{subText}</div>
          )}
        </div>
      </div>

      {/* Right: amount + options menu */}
      <div className="shrink-0 flex items-center gap-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={editVal}
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitEdit()
                if (e.key === "Escape") setEditing(false)
              }}
              className="w-20 bg-[#1c1c1e] border border-[#3f3f46] rounded-md px-2 py-1 text-[13px] text-[#fafafa] font-space text-right outline-none focus:border-[#52525b]"
              autoFocus
            />
            <button
              onClick={submitEdit}
              className="text-[#22c55e] hover:text-[#16a34a] text-[13px] px-1 transition-colors"
              title="Confirm"
            >
              ✓
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-[#52525b] hover:text-[#71717a] text-[13px] px-1 transition-colors"
              title="Cancel"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="text-right">
            {sub.amount != null ? (
              <div className="font-space font-medium text-[14px] text-[#fafafa] leading-none">
                {sym}{sub.amount.toFixed(2)}
                <span className="text-[#52525b] text-[11px] font-normal">{cycleTag}</span>
              </div>
            ) : (
              <div className="text-[11px] text-[#52525b]">—</div>
            )}
          </div>
        )}

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-6 h-6 flex items-center justify-center rounded text-[#3f3f46] hover:text-[#71717a] hover:bg-[#1c1c1e] transition-colors duration-150"
            title="Options"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="2" cy="6" r="1.25" fill="currentColor" />
              <circle cx="6" cy="6" r="1.25" fill="currentColor" />
              <circle cx="10" cy="6" r="1.25" fill="currentColor" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => { setMenuOpen(false); onOverride("not_subscription") }}
                className="w-full text-left px-3.5 py-2 text-[12.5px] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
              >
                Not a subscription
              </button>
              <button
                onClick={() => { setMenuOpen(false); onOverride("free") }}
                className="w-full text-left px-3.5 py-2 text-[12.5px] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
              >
                I don&apos;t pay for this
              </button>
              <div className="border-t border-[#27272a] my-1" />
              <button
                onClick={() => { setMenuOpen(false); setEditing(true) }}
                className="w-full text-left px-3.5 py-2 text-[12.5px] text-[#a1a1aa] hover:text-[#fafafa] hover:bg-[#27272a] transition-colors"
              >
                Edit amount
              </button>
            </div>
          )}
        </div>
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
  const [loadingMsg, setLoadingMsg] = useState("Loading subscriptions…")
  const [scanning, setScanning] = useState(false)
  const autoScanned = useRef(false)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/")
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated") return

    fetch("/api/subscriptions")
      .then((r) => r.json())
      .then(async (d: Partial<ScanData>) => {
        const total = d.total ?? 0
        if (total > 0) {
          setData({ subscriptions: d.subscriptions ?? [], trials: d.trials ?? [], total })
          setLoading(false)
          return
        }
        if (autoScanned.current) { setLoading(false); return }
        autoScanned.current = true
        setLoadingMsg("Scanning your inbox with Claude…")
        try {
          const scan: Partial<ScanData> = await fetch("/api/scan").then((r) => r.json())
          setData({ subscriptions: scan.subscriptions ?? [], trials: scan.trials ?? [], total: scan.total ?? 0 })
        } finally {
          setLoading(false)
        }
      })
      .catch(() => setLoading(false))
  }, [status])

  async function handleRescan() {
    setScanning(true)
    try {
      const d: Partial<ScanData> = await fetch("/api/scan").then((r) => r.json())
      setData({ subscriptions: d.subscriptions ?? [], trials: d.trials ?? [], total: d.total ?? 0 })
    } finally {
      setScanning(false)
    }
  }

  async function applyOverride(serviceName: string, action: OverrideAction, customAmount?: number) {
    // Apply locally first for instant feedback, then persist to the server.
    // Awaiting the save ensures the override is committed before any subsequent rescan.
    if (action === "not_subscription" || action === "free") {
      setData((prev) => {
        const filter = (arr: Subscription[]) => arr.filter((s) => s.serviceName !== serviceName)
        const next = { ...prev, subscriptions: filter(prev.subscriptions), trials: filter(prev.trials) }
        next.total = next.subscriptions.length + next.trials.length
        return next
      })
    } else if (action === "edit_amount" && customAmount !== undefined) {
      setData((prev) => {
        const update = (arr: Subscription[]) =>
          arr.map((s) => (s.serviceName === serviceName ? { ...s, amount: customAmount } : s))
        return { ...prev, subscriptions: update(prev.subscriptions), trials: update(prev.trials) }
      })
    }
    await fetch("/api/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_name: serviceName, action, custom_amount: customAmount ?? null }),
    }).catch(console.error)
  }

  const todayStr = new Date().toISOString().split("T")[0]
  const { subscriptions, trials } = data

  // Only show trials with a future (or unknown) end date
  const futureTrials = trials.filter((s) => !s.renewalDate || s.renewalDate >= todayStr)

  const active = subscriptions.filter((s) => s.status === "active")
  const cancelled = subscriptions.filter((s) => s.status === "cancelled")
  const lapsed = subscriptions.filter((s) => s.status === "lapsed")
  const spend = calcSpend(active)

  return (
    <div className="flex min-h-screen bg-[#09090b] text-[#fafafa]">
      <Sidebar email={session?.user?.email} />

      <div className="flex-1 overflow-auto">
        {/* Page header */}
        <div className="px-10 pt-10 pb-8 border-b border-[#1c1c1e] flex items-start justify-between gap-4">
          <div>
            <h1 className="font-space font-semibold text-[22px] text-[#fafafa] leading-none mb-1">
              Overview
            </h1>
            <p className="text-[13px] text-[#71717a]">Detected from your Gmail by Claude</p>
          </div>
          <button
            onClick={handleRescan}
            disabled={scanning || loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#111113] border border-[#1c1c1e] text-[#71717a] hover:text-[#fafafa] hover:border-[#3f3f46] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed mt-0.5"
          >
            {scanning ? (
              <>
                <div className="w-3 h-3 border border-[#71717a] border-t-[#fafafa] rounded-full animate-spin" />
                Scanning…
              </>
            ) : (
              "Rescan Gmail"
            )}
          </button>
        </div>

        <div className="px-10 py-10 max-w-4xl">
          {status === "loading" || loading || (scanning && data.total === 0) ? (
            <div className="flex items-center gap-3 text-[#71717a] py-4">
              <div className="w-4 h-4 border border-[#71717a] border-t-[#fafafa] rounded-full animate-spin" />
              <span className="text-[13px]">{scanning ? "Scanning your inbox with Claude…" : loadingMsg}</span>
            </div>
          ) : (
            <>
              {/* ── Stats: 1-col on mobile, 3-col on desktop ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 mb-14 border-b border-[#1c1c1e] pb-12">
                <div className="pb-8 sm:pb-0 sm:pr-10 border-b sm:border-b-0 border-[#1c1c1e]">
                  <StatBlock value={String(data.total)} unit="found" label="subscriptions" />
                </div>
                <div className="py-8 sm:py-0 sm:px-10 border-b sm:border-b-0 sm:border-l sm:border-r border-[#1c1c1e]">
                  <StatBlock
                    value={spend.any ? `£${spend.monthly.toFixed(2)}` : "—"}
                    unit="/month"
                    label="est. monthly spend"
                    noUnit={!spend.any}
                  />
                </div>
                <div className="pt-8 sm:pt-0 sm:pl-10">
                  <StatBlock
                    value={spend.any ? `£${spend.annual.toFixed(2)}` : "—"}
                    unit="/year"
                    label="est. annual spend"
                    noUnit={!spend.any}
                  />
                </div>
              </div>

              {/* ── Trials ── */}
              {futureTrials.length > 0 && (
                <SubSection title="Trials ending soon" count={futureTrials.length} dot={STATUS_COLOR.trial}>
                  {futureTrials.map((s) => (
                    <SubCard
                      key={s.emailId}
                      sub={s}
                      leftColor={STATUS_COLOR.trial}
                      onOverride={(action, amount) => applyOverride(s.serviceName, action, amount)}
                    />
                  ))}
                </SubSection>
              )}

              {/* ── Active ── */}
              {active.length > 0 && (
                <SubSection title="Active" count={active.length} dot={STATUS_COLOR.active}>
                  {active.map((s) => (
                    <SubCard
                      key={s.emailId}
                      sub={s}
                      leftColor={STATUS_COLOR.active}
                      onOverride={(action, amount) => applyOverride(s.serviceName, action, amount)}
                    />
                  ))}
                </SubSection>
              )}

              {/* ── Cancelled ── */}
              {cancelled.length > 0 && (
                <SubSection title="Cancelled" count={cancelled.length} dot={STATUS_COLOR.cancelled}>
                  {cancelled.map((s) => (
                    <SubCard
                      key={s.emailId}
                      sub={s}
                      leftColor={STATUS_COLOR.cancelled}
                      onOverride={(action, amount) => applyOverride(s.serviceName, action, amount)}
                    />
                  ))}
                </SubSection>
              )}

              {/* ── Possibly inactive (lapsed) ── */}
              {lapsed.length > 0 && (
                <SubSection title="Possibly inactive" count={lapsed.length} dot={STATUS_COLOR.lapsed} defaultCollapsed={true}>
                  {lapsed.map((s) => (
                    <SubCard
                      key={s.emailId}
                      sub={s}
                      leftColor={STATUS_COLOR.lapsed}
                      onOverride={(action, amount) => applyOverride(s.serviceName, action, amount)}
                    />
                  ))}
                </SubSection>
              )}

              {/* ── Empty state — hidden while a scan is running ── */}
              {data.total === 0 && !scanning && (
                <div className="py-20 text-center">
                  <div className="text-5xl mb-5 opacity-10 font-space font-semibold select-none" aria-hidden="true">
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
