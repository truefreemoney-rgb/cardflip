/**
 * Ad landing pages for one Pokémon name: /pokemon/{slug}-card-value (Chris 10-07: one Google Ads ad group per name,
 * keyword + headline + page all say "Charizard Card Value"). Add a name here when its ad group is built; the page
 * reads only names on this list, so a typed URL can never start a catalog walk.
 */
export const POKEMON_NAME_LANDINGS: Record<string, string> = {
  charizard: "Charizard",
  pikachu: "Pikachu",
  dragonite: "Dragonite",
  mewtwo: "Mewtwo",
  umbreon: "Umbreon",
  rayquaza: "Rayquaza",
};

export const nameLandingPath = (slug: string) => `/pokemon/${slug}-card-value`;

/** "charizard-card-value" → { slug, name }, or null when the name is not on the list. */
export function parseNameLanding(segment: string): { slug: string; name: string } | null {
  const m = /^([a-z0-9-]+)-card-value$/.exec(segment);
  if (!m) return null;
  const name = POKEMON_NAME_LANDINGS[m[1]];
  return name ? { slug: m[1], name } : null;
}
