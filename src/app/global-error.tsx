"use client";

/** The root layout itself crashed: no Tailwind-dependent layout is guaranteed, so plain inline styles. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0f", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#a1a1aa", fontSize: 14, margin: 0, maxWidth: 300 }}>That didn&apos;t load. Try again, and if it keeps happening, come back in a minute.</p>
          <button type="button" onClick={reset} style={{ background: "#6366f1", color: "#fff", border: 0, borderRadius: 999, padding: "12px 24px", fontSize: 16, fontWeight: 600 }}>
            Try Again
          </button>
          {/* A plain link on purpose: the router may be what broke. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ color: "#a1a1aa", fontSize: 14 }}>
            Go Home
          </a>
        </main>
      </body>
    </html>
  );
}
