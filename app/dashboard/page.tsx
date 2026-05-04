"use client"

import { useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

type Email = {
  id: string
  subject: string
  from: string
}

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/")
  }, [status])

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/scan")
        .then(res => res.json())
        .then(data => {
          setEmails(data.emails || [])
          setLoading(false)
        })
    }
  }, [status])

  if (status === "loading" || loading) {
    return (
      <main className="min-h-screen bg-[#0a0e1a] flex items-center justify-center text-white">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⚙️</div>
          <p className="text-[#8892a4]">Scanning your Gmail...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0e1a] text-white">
      {/* Header */}
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
        {/* Stats */}
        <div className="mb-8">
          <h1 className="font-syne font-bold text-2xl mb-2">Your Subscriptions</h1>
          <p className="text-[#8892a4] text-sm">Found {emails.length} subscription-related emails in your Gmail</p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-[#8892a4] uppercase tracking-widest mb-2">Emails Found</div>
            <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">{emails.length}</div>
          </div>
          <div className="bg-[#111827] border border-white/10 rounded-2xl p-5">
            <div className="text-xs text-[#8892a4] uppercase tracking-widest mb-2">Query Used</div>
            <div className="font-mono text-xs text-[#8892a4] mt-1 leading-relaxed">subject:(subscription OR receipt OR invoice OR billing OR renewal)</div>
          </div>
        </div>

        {/* Email list */}
        <div className="flex flex-col gap-3">
          {emails.map(email => (
            <div key={email.id} className="bg-[#111827] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all">
              <div className="font-syne font-bold text-sm mb-1">{email.subject}</div>
              <div className="text-[#8892a4] text-xs">{email.from}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}