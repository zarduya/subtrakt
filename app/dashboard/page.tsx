"use client"

import { useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

type Subscription = {
  emailId: string
  serviceName: string
  amount: number | null
  currency: string | null
  renewalDate: string | null
  status: string
  from: string
  subject: string
}

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/")
  }, [status])

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/scan")
        .then(res => res.json())
        .then(data => {
          setSubs(data.subscriptions || [])
          setLoading(false)
        })
    }
  }, [status])

  const active = subs.filter(s => s.status === "active")
  const cancelled = subs.filter(s => s.status === "cancelled")

  const statusColor = (s: string) => {
    if (s === "active") return "text-[#00e5a0]"
    if (s === "cancelled") return "text-red-400"
    return "text-yellow-400"
  }

  if (status === "loading" || loading) {
    return (
      <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center text-white">
        <div className="text-center">
          <div className="text-5xl mb-6 animate-spin">⚙️</div>
          <p className="font-syne font-bold text-lg mb-2">Scanning your Gmail...</p>
          <p className="text-[#8892a4] text-sm">Claude is reading your subscription emails</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] text-white">
      <div className="flex items-center justify-between px-8 py-5 border-b border-white/10 bg-[#111827]">
        <div className="font-syne font-extrabold text-xl">
          Sub<span className="text-[#00e5a0]">trakt</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#8892a4] text-sm">{session?.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="border border-white/10 text-[#8892a4] text-sm px-4 py-2 rounded-lg hover:border-red-400 hover:text-red-400 transition-all"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="px-8 py-8 max-w-4xl mx-auto">
        <h1 className="font-syne font-bold text-2xl mb-2">Your Subscriptions</h1>
        <p className="text-[#8892a4] text-sm mb-8">Detected by Claude from your Gmail</p>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-[#8892a4] uppercase tracking-widest mb-2">Total</div>
            <div className="font-syne font-extrabold text-3xl">{subs.length}</div>
          </div>
          <div className="bg-[#111827] border border-[#00e5a0]/20 rounded-2xl p-5">
            <div className="text-xs text-[#8892a4] uppercase tracking-widest mb-2">Active</div>
            <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">{active.length}</div>
          </div>
          <div className="bg-[#111827] border border-red-400/20 rounded-2xl p-5">
            <div className="text-xs text-[#8892a4] uppercase tracking-widest mb-2">Cancelled</div>
            <div className="font-syne font-extrabold text-3xl text-red-400">{cancelled.length}</div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {subs.map(sub => (
            <div key={sub.emailId} className="bg-[#111827] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-syne font-bold text-base">{sub.serviceName}</span>
                    <span className={statusColor(sub.status) + " text-xs"}>● {sub.status}</span>
                  </div>
                  <div className="text-[#8892a4] text-xs">{sub.from}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  {sub.amount && (
                    <div className="font-syne font-bold">{sub.currency} {sub.amount}</div>
                  )}
                  {sub.renewalDate && (
                    <div className="text-xs text-[#8892a4] mt-1">Renews {sub.renewalDate}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}