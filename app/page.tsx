"use client"

import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function Home() {
  const { data: session } = useSession()
  const router = useRouter()

  return (
    <main className="min-h-screen bg-[#0a0e1a] flex flex-col items-center justify-center text-white text-center px-6 relative overflow-hidden">

      {/* Background orbs */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-[#00e5a0] opacity-10 blur-[80px] -top-32 -left-32 pointer-events-none" />
      <div className="absolute w-[400px] h-[400px] rounded-full bg-[#0070f3] opacity-10 blur-[80px] -bottom-20 -right-20 pointer-events-none" />

      {/* Logo */}
      <div className="font-syne font-extrabold text-3xl mb-16 tracking-tight">
        Sub<span className="text-[#00e5a0]">trakt</span>
      </div>

      {/* Hero */}
      <h1 className="font-syne font-bold text-5xl md:text-6xl leading-tight tracking-tight mb-5 max-w-2xl">
        Stop losing money to{" "}
        <span className="text-[#00e5a0]">forgotten subscriptions</span>
      </h1>

      <p className="text-[#8892a4] text-lg max-w-md leading-relaxed mb-12">
        Subtrakt scans your Gmail for subscription emails — automatically
        finding renewals before they hit your card. Free, forever.
      </p>

      {/* CTA */}
      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-[#00e5a0] font-syne font-bold text-lg">
            Welcome, {session.user?.name?.split(" ")[0]}! 👋
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-[#00e5a0] text-[#0a0e1a] font-syne font-bold text-base px-9 py-4 rounded-2xl hover:shadow-[0_12px_40px_rgba(0,229,160,0.35)] hover:-translate-y-1 transition-all duration-200"
          >
            🔍 Scan My Gmail
          </button>
        </div>
      ) : (
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="bg-[#00e5a0] text-[#0a0e1a] font-syne font-bold text-base px-9 py-4 rounded-2xl hover:shadow-[0_12px_40px_rgba(0,229,160,0.35)] hover:-translate-y-1 transition-all duration-200"
        >
          🔍 Scan My Gmail — It's Free
        </button>
      )}

      {/* Stats */}
      <div className="flex gap-12 mt-20 flex-wrap justify-center">
        <div>
          <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">£340</div>
          <div className="text-[#8892a4] text-sm mt-1">avg. wasted per year</div>
        </div>
        <div>
          <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">12</div>
          <div className="text-[#8892a4] text-sm mt-1">avg. subscriptions/person</div>
        </div>
        <div>
          <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">100%</div>
          <div className="text-[#8892a4] text-sm mt-1">free, always</div>
        </div>
      </div>

    </main>
  )
}