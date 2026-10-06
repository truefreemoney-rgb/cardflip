import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SetView, parsePageNumber, redirectPageOne, setMetadata } from "@/components/SetPageView";

/** /cards/{game}/{set-slug}/page/{n}: the later pages of a big set (300 cards each). Page 1 redirects to the set page. */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

export async function generateMetadata({ params }: PageProps<"/cards/[game]/[set]/page/[n]">): Promise<Metadata> {
  const { game, set, n } = await params;
  const page = parsePageNumber(n);
  if (!page) return { title: "Card prices" };
  return setMetadata(game, set, page);
}

export default async function SetLaterPage({ params }: PageProps<"/cards/[game]/[set]/page/[n]">) {
  const { game, set, n } = await params;
  const page = parsePageNumber(n);
  if (!page) notFound();
  if (page === 1) await redirectPageOne(game, set);
  return <SetView gameSlug={game} setSlug={set} page={page} />;
}
