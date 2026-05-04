code = """\"use client\"

import { useEffect, useState } from \"react\"
import { useSession, signOut } from \"next-auth/react\"
import { useRouter } from \"next/navigation\"

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
    if (status === \"unauthenticated\") router.push(\"/\")
  }, [status])

  useEffect(() => {
    if (status === \"authenticated\") {
      fetch(\"/api/scan\")
        .then(res => res.json())
        .then(data => {
          setSubs(data.subscriptions || [])
          setLoading(false)
        })
    }
  }, [status])

  const active = subs.filter(s => s.status === \"active\")
  const cancelled = subs.filter(s => s.status === \"cancelled\")

  const statusColor = (status: string) => {
    if (status === \"active\") return \"text-[#00e5a0] bg-[#00e5a0]/10 border-[#00e5a0]/20\"
    if (status === \"cancelled\") return \"text-red-400 bg-red-400/10 border-red-400/20\"
    return \"text-yellow-400 bg-yellow-400/10 border-yellow-400/20\"
  }

  if (status === \"loading\" || loading) {
    return (
      <main className=\"min-h-screen bg-[#0a0e1a] flex items-center justify-center text-white\">
        <div className=\"text-center\">
          <div className=\"text-5xl mb-6 animate-spin\">⚙️</div>
          <p className=\"font-syne font-bold text-lg mb-2\">Scanning your Gmail...</p>
          <p className=\"text-[#8892a4] text-sm\">Claude is reading your subscription emails</p>
        </div>
      </main>
    )
  }

  return (
    <main className=\"min-h-screen bg-[#0a0e1a] text-white\">
      <div className=\"flex items-center justify-between px-8 py-5 border-b border-white/10 bg-[#111827]\">
        <div className=\"font-syne font-extrabold text-xl\">
          Sub<span className=\"text-[#00e5a0]\">trakt</span>
        </div>
        <div className=\"flex items-center gap-4\">
          <span className=\"text-[#8892a4] text-sm\">{session?.user?.email}</span>
          <button
            onClick={() => signOut({ callbackUrl: \"/\" })}
            className=\"border border-white/10 text-[#8892a4] text-sm px-4 py-2 rounded-lg hover:border-red-400 hover:text-red-400 transition-all\"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className=\"px-8 py-8 max-w-4xl mx-auto\">
        <h1 className=\"font-syne font-bold text-2xl mb-2\">Your Subscriptions</h1>
        <p className=\"text-[#8892a4] text-sm mb-8\">Detected by Claude from your Gmail — only subscription emails were scanned</p>

        <div className=\"grid grid-cols-3 gap-4 mb-8\">
          <div className=\"bg-[#111827] border border-white/10 rounded-2xl p-5\">
            <div className=\"text-xs text-[#8892a4] uppercase tracking-widest mb-2\">Total Found</div>
            <div className=\"font-syne font-extrabold text-3xl\">{subs.length}</div>
          </div>
          <div className=\"bg-[#111827] border border-[#00e5a0]/20 rounded-2xl p-5\">
            <div className=\"text-xs text-[#8892a4] uppercase tracking-widest mb-2\">Active</div>
            <div className=\"font-syne font-extrabold text-3xl text-[#00e5a0]\">{active.length}</div>
          </div>
          <div className=\"bg-[#111827] border border-red-400/20 rounded-2xl p-5\">
            <div className=\"text-xs text-[#8892a4] uppercase tracking-widest mb-2\">Cancelled</div>
            <div className=\"font-syne font-extrabold text-3xl text-red-400\">{cancelled.length}</div>
          </div>
        </div>

        <div className=\"bg-[#00e5a0]/05 border border-[#00e5a0]/20 rounded-2xl p-4 mb-8 flex gap-3\">
          <span className=\"text-lg\">🔎</span>
          <div>
            <p className=\"text-[#00e5a0] font-bold text-sm mb-1\">Full transparency</p>
            <p className=\"text-[#8892a4] text-xs\">We only searched: subject:(subscription OR receipt OR invoice OR trial OR billing OR renewal). Claude extracted service names and dates only — no email body was stored.</p>
          </div>
        </div>

        <div className=\"flex flex-col gap-3\">
          {subs.map(sub => (
            <div key={sub.emailId} className=\"bg-[#111827] border border-white/10 rounded-2xl p-5 hover:border-white/20 transition-all\">
              <div className=\"flex items-start justify-between gap-4\">
                <div className=\"flex-1\">
                  <div className=\"flex items-center gap-2 mb-1\">
                    <span className=\"font-syne font-bold text-base\">{sub.serviceName}</span>
                    <span className={\"text-xs px-2 py-0.5 rounded-full border \" + statusColor(sub.status)}>
                      {sub.status}
                    </span>
                  </div>
                  <div className=\"text-[#8892a4] text-xs mb-1\">{sub.from}</div>
                  <div className=\"text-[#8892a4] text-xs italic\">{sub.subject}</div>