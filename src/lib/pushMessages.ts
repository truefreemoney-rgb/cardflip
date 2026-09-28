/**
 * Phone notification copy (Tier 2 #9) — pure builders shared by the sweeps
 * and the tests. One banner per event, short enough for a lock screen, and
 * every one opens the page where the seller acts on it.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** In-app path the tap opens. */
  url: string;
  /** Same tag = the newer banner replaces the older one on the phone. */
  tag: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export function wishlistDipPush(hits: { name: string; price: number; target: number }[]): PushMessage {
  if (hits.length === 1) {
    const h = hits[0];
    return { title: `${h.name} dipped to ${money(h.price)}`, body: `Your alert was ${money(h.target)}. Tap to see it on your watchlist.`, url: "/app/wishlist", tag: "wishlist-dip" };
  }
  return {
    title: `${hits.length} watchlist cards hit your prices`,
    body: hits.slice(0, 3).map((h) => `${h.name} ${money(h.price)}`).join(" · ") + (hits.length > 3 ? " · …" : ""),
    url: "/app/wishlist",
    tag: "wishlist-dip",
  };
}

export function cardAlertPush(hits: { name: string; price: number; target: number; kind: "target" | "spike" }[]): PushMessage {
  const targets = hits.filter((h) => h.kind === "target");
  const spikes = hits.filter((h) => h.kind === "spike");
  if (hits.length === 1) {
    const h = hits[0];
    if (h.kind === "target") {
      return { title: `${h.name} reached ${money(h.price)}`, body: `Your alert was ${money(h.target)}. Tap to list it.`, url: "/app/collection", tag: "card-alert" };
    }
    const pct = h.target > 0 ? Math.round(((h.price - h.target) / h.target) * 100) : 0;
    return { title: `${h.name} is up ${pct}% this week`, body: `${money(h.price)} today, ${money(h.target)} a week ago. Good time to sell.`, url: "/app/collection", tag: "card-alert" };
  }
  const parts: string[] = [];
  if (targets.length) parts.push(`${targets.length} reached your price`);
  if (spikes.length) parts.push(`${spikes.length} spiked this week`);
  return {
    title: `${hits.length} of your cards moved`,
    body: parts.join(" · ") + ". Tap to see them.",
    url: "/app/collection",
    tag: "card-alert",
  };
}

export function soldPush(cards: { name: string; soldPrice: number | null }[]): PushMessage {
  if (cards.length === 1) {
    const c = cards[0];
    return { title: `${c.name} sold${c.soldPrice != null ? ` for ${money(c.soldPrice)}` : ""}`, body: "Ship it. Inventory has the order.", url: "/app/collection", tag: "sold" };
  }
  const total = cards.reduce((n, c) => n + (c.soldPrice ?? 0), 0);
  return { title: `${cards.length} cards sold${total > 0 ? ` · ${money(total)}` : ""}`, body: cards.slice(0, 3).map((c) => c.name).join(" · ") + (cards.length > 3 ? " · …" : ""), url: "/app/collection", tag: "sold" };
}

export function ticketReplyPush(ticket: { number: number }, body: string): PushMessage {
  const preview = body.replace(/\s+/g, " ").trim();
  return {
    title: `Support replied on ticket #${ticket.number}`,
    body: preview.length > 120 ? preview.slice(0, 117) + "…" : preview || "Tap to read the reply.",
    url: "/app/help",
    tag: `ticket-${ticket.number}`,
  };
}
