import type { Metadata } from "next"
import "./globals.css"
import Providers from "./providers"

export const metadata: Metadata = {
  title: "Subtrakt — Find every subscription bleeding you dry",
  description: "Subtrakt scans your Gmail and surfaces every recurring charge you forgot about.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* SVG noise filter — zero size, invisible, referenced by the overlay below */}
        <svg
          aria-hidden="true"
          style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
        >
          <defs>
            <filter id="grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.8"
                numOctaves="4"
                stitchTiles="stitch"
              />
            </filter>
          </defs>
        </svg>
        {/* Grain texture overlay — fixed, pointer-events-none */}
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 9999,
            opacity: 0.038,
            filter: "url(#grain)",
            background: "#fff",
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
