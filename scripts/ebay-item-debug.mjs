// Operator debug: what does eBay publicly show for a listing we published?
// Usage (on the Fly machine, where EBAY_CLIENT_ID/SECRET live):
//   flyctl ssh console --app cardflip-superior -C "node scripts/ebay-item-debug.mjs <ebayListingId>"
// Prints the Browse API view: title, price, image + additionalImages, condition.
const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/ebay-item-debug.mjs <ebayListingId>");
  process.exit(2);
}
const { EBAY_CLIENT_ID: cid, EBAY_CLIENT_SECRET: sec } = process.env;
if (!cid || !sec) {
  console.error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set");
  process.exit(2);
}
const tok = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: "Basic " + Buffer.from(`${cid}:${sec}`).toString("base64"),
  },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  }),
}).then((r) => r.json());
if (!tok.access_token) {
  console.error("token:", JSON.stringify(tok));
  process.exit(1);
}
const res = await fetch(
  `https://api.ebay.com/buy/browse/v1/item/v1|${encodeURIComponent(id)}|0`,
  {
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  },
);
const body = await res.json();
console.log("status", res.status);
if (!res.ok) {
  console.log(JSON.stringify(body, null, 1));
  process.exit(1);
}
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
console.log(
  JSON.stringify(
    pick(body, [
      "itemId",
      "title",
      "price",
      "condition",
      "conditionId",
      "conditionDescriptors",
      "image",
      "additionalImages",
      "itemWebUrl",
      "itemLocation",
      "shippingOptions",
      "estimatedAvailabilities",
    ]),
    null,
    1,
  ),
);
