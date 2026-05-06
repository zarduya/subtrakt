"use client"

import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function Home() {
  const { data: session } = useSession()
  const router = useRouter()

  return (
    <main className="min-h-screen bg-[#0a0e1a] flex flex-col items-center justify-center text-white text-center px-6 relative overflow-hidden">

      {/* Ambient glow orbs */}
      <div className="absolute w-[600px] h-[600px] rounded-full bg-[#00e5a0] opacity-[0.07] blur-[120px] -top-40 -left-40 pointer-events-none" />
      <div className="absolute w-[500px] h-[500px] rounded-full bg-[#0070f3] opacity-[0.07] blur-[100px] -bottom-20 -right-20 pointer-events-none" />
      <div className="absolute w-[300px] h-[300px] rounded-full bg-[#00e5a0] opacity-[0.04] blur-[80px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

      {/* Logo */}
      <div className="font-syne font-extrabold text-2xl mb-14 tracking-tight">
        Sub<span className="text-[#00e5a0]">trakt</span>
      </div>

      {/* Badge */}
      <div className="mb-6 inline-flex items-center gap-2 bg-[#00e5a0]/10 border border-[#00e5a0]/20 text-[#00e5a0] text-xs px-4 py-1.5 rounded-full font-medium tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00e5a0] animate-pulse" />
        Free · No credit card required
      </div>

      {/* Hero */}
      <h1 className="font-syne font-bold text-5xl md:text-6xl lg:text-7xl leading-[1.08] tracking-tight mb-6 max-w-3xl">
        Stop losing money to{" "}
        <span className="text-[#00e5a0]">forgotten subscriptions</span>
      </h1>

      <p className="text-[#8892a4] text-lg max-w-md leading-relaxed mb-12">
        Subtrakt connects to your Gmail and uses AI to surface every recurring charge — before it hits your card.
      </p>

      {/* CTA */}
      {session ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-[#00e5a0] font-syne font-semibold">
            Welcome back, {session.user?.name?.split(" ")[0]}
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="group relative bg-[#00e5a0] text-[#0a0e1a] font-syne font-bold text-base px-10 py-4 rounded-2xl hover:shadow-[0_16px_48px_rgba(0,229,160,0.4)] hover:-translate-y-1 transition-all duration-200"
          >
            View Dashboard
          </button>
        </div>
      ) : (
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="group relative bg-[#00e5a0] text-[#0a0e1a] font-syne font-bold text-base px-10 py-4 rounded-2xl hover:shadow-[0_16px_48px_rgba(0,229,160,0.4)] hover:-translate-y-1 transition-all duration-200"
        >
          Scan My Gmail — It&apos;s Free
        </button>
      )}

      <p className="text-[#8892a4]/60 text-xs mt-4">Read-only Gmail access · Never stores your emails</p>

      {/* Stats */}
      <div className="flex gap-10 md:gap-16 mt-20 flex-wrap justify-center">
        {[
          { value: "£340", label: "avg. wasted per year" },
          { value: "12", label: "avg. subscriptions per person" },
          { value: "100%", label: "free, always" },
        ].map((stat) => (
          <div key={stat.label}>
            <div className="font-syne font-extrabold text-3xl text-[#00e5a0]">{stat.value}</div>
            <div className="text-[#8892a4] text-sm mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

    </main>
  )
}
