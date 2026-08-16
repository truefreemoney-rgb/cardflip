import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";

export interface LegalSection {
  heading: string;
  /** Each string renders as its own paragraph. */
  paragraphs: string[];
}

interface Props {
  title: string;
  effectiveDate: string;
  intro: string;
  sections: LegalSection[];
}

/**
 * Shared shell for the legal pages (/terms, /privacy) so they read as one
 * document family: same nav, same measure, same type scale, same footer.
 */
export default function LegalArticle({
  title,
  effectiveDate,
  intro,
  sections,
}: Props) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Effective date: {effectiveDate}
        </p>
        <p className="mt-6 text-sm leading-relaxed text-zinc-400">{intro}</p>

        <div className="mt-10 space-y-10">
          {sections.map((section, i) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold text-white">
                {i + 1}. {section.heading}
              </h2>
              {section.paragraphs.map((text) => (
                <p
                  key={text.slice(0, 40)}
                  className="mt-3 text-sm leading-relaxed text-zinc-400"
                >
                  {text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
