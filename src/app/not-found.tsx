import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingNav />
      <main className="hero-mesh grain relative flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <p className="holo-text text-5xl font-bold">404</p>
        <h1 className="text-2xl font-semibold text-white">
          That page doesn&apos;t exist
        </h1>
        <p className="max-w-sm text-sm text-zinc-400">
          The card you&apos;re looking for isn&apos;t in this binder. Head back
          home and start from there.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400"
        >
          Back to CardFlip
        </Link>
      </main>
      <Footer />
    </div>
  );
}
