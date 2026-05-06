"use client"

import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"

const STATS = [
  { value: "£340", label: "avg. wasted per year" },
  { value: "12", label: "avg. subscriptions per person" },
  { value: "Free", label: "always, no credit card" },
]

export default function Home() {
  const { data: session } = useSession()
  const router = useRouter()

  return (
    <div className="min-h-screen bg-[#09090b] dot-grid text-[#fafafa] flex flex-col">

      {/* Nav */}
      <nav className="flex items-center justify-between px-8 md:px-16 py-6 border-b border-[#1c1c1e]">
        <span className="font-space font-medium text-base tracking-tight">Subtrakt</span>
        {session ? (
          <button
            onClick={() => router.push("/dashboard")}
            className="text-sm text-[#71717a] hover:text-[#fafafa] transition-colors duration-150"
          >
            Dashboard →
          </button>
        ) : (
          <button
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            className="text-sm text-[#71717a] hover:text-[#fafafa] transition-colors duration-150"
          >
            Sign in
          </button>
        )}
      </nav>

      {/* Hero */}
      <div className="flex-1 flex flex-col justify-center px-8 md:px-16 pt-16 pb-20 md:pt-28 md:pb-32">
        <div className="max-w-5xl">
          <h1
            className="font-space font-semibold leading-[0.92] tracking-[-0.03em] mb-10 md:mb-14"
            style={{ fontSize: "clamp(3.25rem, 8.5vw, 8rem)" }}
          >
            Your inbox<br />
            is leaking<br />
            <span style={{ color: "#e8ff47" }}>money.</span>
          </h1>

          <div className="flex flex-col md:flex-row items-start gap-8 md:gap-16">
            <p className="text-[#71717a] text-lg leading-relaxed max-w-[22rem]">
              Subtrakt connects to Gmail and surfaces every recurring charge you
              forgot about — before it hits your card again.
            </p>

            <div className="flex flex-col items-start gap-3">
              {session ? (
                <button
                  onClick={() => router.push("/dashboard")}
                  className="group inline-flex items-center gap-2 bg-[#e8ff47] text-[#09090b] font-space font-semibold text-base px-7 py-3.5 rounded-md hover:bg-[#f0ff72] active:scale-[0.98] transition-all duration-150"
                >
                  Go to Dashboard
                  <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                </button>
              ) : (
                <button
                  onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
                  className="group inline-flex items-center gap-2 bg-[#e8ff47] text-[#09090b] font-space font-semibold text-base px-7 py-3.5 rounded-md hover:bg-[#f0ff72] active:scale-[0.98] transition-all duration-150"
                >
                  Scan My Gmail
                  <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                </button>
              )}
              <p className="text-[#71717a]/50 text-xs">Read-only access · No emails ever stored</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats footer strip */}
      <div className="border-t border-[#1c1c1e] px-8 md:px-16 py-8">
        <div className="flex gap-10 md:gap-20 flex-wrap">
          {STATS.map((s) => (
            <div key={s.label}>
              <div className="font-space font-semibold text-xl text-[#fafafa]">{s.value}</div>
              <div className="text-[#71717a] text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
