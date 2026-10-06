import type { Metadata } from "next";
import { SetView, setMetadata } from "@/components/SetPageView";

/**
 * /cards/{game}/{set-slug}: page 1 of one set's cards priced at the floor or
 * more, most valuable first (later pages: ./page/{n}, see setView.tsx).
 * On-demand ISR: nothing built ahead, kept two days.
 */

export const revalidate = 172800;
export const generateStaticParams = async () => [];

export async function generateMetadata({ params }: PageProps<"/cards/[game]/[set]">): Promise<Metadata> {
  const { game, set } = await params;
  return setMetadata(game, set, 1);
}

export default async function SetPage({ params }: PageProps<"/cards/[game]/[set]">) {
  const { game, set } = await params;
  return <SetView gameSlug={game} setSlug={set} page={1} />;
}
