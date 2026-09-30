import { NextResponse, type NextRequest } from "next/server";
import { cronAuthError } from "@/lib/server/cronAuth";
import { getAppToken } from "@/lib/server/ebay";
import { getUserAccessToken } from "@/lib/server/ebayAuth";

/**
 * Read-only research for per-country eBay listing (Chris 09-30): what the
 * CCG categories, aspects, condition descriptors and domestic shipping
 * services look like on EBAY_GB / AU / CA / IE next to EBAY_US. GETs eBay's
 * public Taxonomy + Metadata APIs with the app token (the keyset only lives
 * on Vercel). ?user=<id> adds Trading GeteBayDetails shipping services with
 * that account's own token. CRON_SECRET bearer only; writes nothing.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://cardflip.io/api/admin/ebay-marketplaces?mk=EBAY_GB"
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MARKETPLACES = ["EBAY_US", "EBAY_GB", "EBAY_AU", "EBAY_CA", "EBAY_IE"] as const;
const TRADING_SITE: Record<string, string> = { EBAY_US: "0", EBAY_GB: "3", EBAY_AU: "15", EBAY_CA: "2", EBAY_IE: "205" };
const CATEGORIES = [183454, 183456, 261044];

async function get(url: string, token: string, mk: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": mk, "Accept-Language": "en-US" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body };
}

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const mk = req.nextUrl.searchParams.get("mk") ?? "";
  if (!(MARKETPLACES as readonly string[]).includes(mk)) {
    return NextResponse.json({ error: `mk must be one of ${MARKETPLACES.join(", ")}` }, { status: 400 });
  }
  const token = await getAppToken();
  const out: Record<string, unknown> = {};
  const tree = await get(`https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${mk}`, token, mk);
  out.tree = tree;
  const treeId = (tree.body as { categoryTreeId?: string })?.categoryTreeId;
  if (treeId) {
    for (const c of CATEGORIES) {
      out[`subtree_${c}`] = await get(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_category_subtree?category_id=${c}`, token, mk);
    }
    out.aspects_183454 = await get(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}/get_item_aspects_for_category?category_id=183454`, token, mk);
  }
  for (const c of CATEGORIES) {
    out[`cond_${c}`] = await get(`https://api.ebay.com/sell/metadata/v1/marketplace/${mk}/get_item_condition_policies?filter=categoryIds:%7B${c}%7D`, token, mk);
  }
  out.return = await get(`https://api.ebay.com/sell/metadata/v1/marketplace/${mk}/get_return_policies?filter=categoryIds:%7B183454%7D`, token, mk);
  out.listing_structure = await get(`https://api.ebay.com/sell/metadata/v1/marketplace/${mk}/get_listing_structure_policies?filter=categoryIds:%7B183454%7D`, token, mk);

  const user = req.nextUrl.searchParams.get("user");
  if (user) {
    const userToken = await getUserAccessToken(user).catch(() => null);
    if (!userToken) out.shipping = { error: "no eBay token for that user" };
    else {
      const res = await fetch("https://api.ebay.com/ws/api.dll", {
        method: "POST",
        headers: {
          "X-EBAY-API-CALL-NAME": "GeteBayDetails",
          "X-EBAY-API-SITEID": TRADING_SITE[mk],
          "X-EBAY-API-COMPATIBILITY-LEVEL": "1193",
          "X-EBAY-API-IAF-TOKEN": userToken,
          "Content-Type": "text/xml",
        },
        body: `<?xml version="1.0" encoding="utf-8"?><GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailName>ShippingServiceDetails</DetailName></GeteBayDetailsRequest>`,
        signal: AbortSignal.timeout(15_000),
      });
      out.shipping = { status: res.status, xml: await res.text() };
    }
  }
  return NextResponse.json(out);
}
