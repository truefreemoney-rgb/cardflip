// Verify our hardcoded eBay condition-descriptor ids against eBay's own
// Metadata API — the check lib/ebayInventory.ts's comment prescribes.
//
//   node scripts/check-condition-descriptors.mjs
//
// Context (STATE.md open thread a, 08-27): a real push warned "saved without
// condition detail" — eBay 500'd on the inventory item until the ladder
// stripped `conditionDescriptors`, so our descriptor table is suspect.
// getItemConditionPolicies is the source of truth: per category it lists the
// allowed conditions and, for 183454 (CCG singles), the condition-descriptor
// names/values. Read-only; uses an application token (client credentials),
// no seller token needed.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.vercel.local"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)="?(.*?)"?$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
  console.error("missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET in .env.vercel.local");
  process.exit(1);
}

const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
const tokenRes = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
  method: "POST",
  headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  }),
});
if (!tokenRes.ok) {
  console.error("app token failed:", tokenRes.status, (await tokenRes.text()).slice(0, 300));
  process.exit(1);
}
const { access_token } = await tokenRes.json();

// 183454 CCG singles (raw + graded), 183456 packs, 261044 boxes.
const CATEGORIES = ["183454", "183456", "261044"];
const url =
  "https://api.ebay.com/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=" +
  encodeURIComponent(`categoryIds:{${CATEGORIES.join("|")}}`);
const res = await fetch(url, {
  headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" },
});
const body = await res.text();
if (!res.ok) {
  console.error("getItemConditionPolicies failed:", res.status, body.slice(0, 500));
  process.exit(1);
}
const data = JSON.parse(body);

// What lib/ebayInventory.ts currently hardcodes.
const OURS = {
  conditions: { ungraded: "4000 (USED_VERY_GOOD)", graded: "2750 (LIKE_NEW)" },
  descriptors: {
    40001: { use: "Card Condition (ungraded)", values: { "Near Mint": "400010", "Lightly Played": "400011", "Moderately Played": "400012", "Heavily Played/Damaged": "400013" } },
    27501: { use: "Professional Grader", values: { PSA: "275010", CGC: "275015" } },
    27502: { use: "Grade", values: { "10": "275020", "…1 (half steps)": "2750218" } },
  },
};
console.log("=== ours (lib/ebayInventory.ts) ===");
console.log(JSON.stringify(OURS, null, 2));

console.log("\n=== eBay's answer ===");
for (const policy of data.itemConditionPolicies ?? []) {
  console.log(`\ncategory ${policy.categoryId} (descriptors ${policy.itemConditionRequired ? "condition REQUIRED" : "condition optional"}):`);
  for (const cond of policy.itemConditions ?? []) {
    console.log(`  condition ${cond.conditionId}: ${cond.conditionDescription}`);
    for (const d of cond.conditionDescriptors ?? []) {
      const req = (d.usage ?? "").toUpperCase();
      console.log(`    descriptor ${d.conditionDescriptorId} "${d.conditionDescriptorName}" ${req ? `[${req}]` : ""}`);
      for (const v of d.conditionDescriptorValues ?? []) {
        console.log(`      ${v.conditionDescriptorValueId} = ${v.conditionDescriptorValueName}`);
      }
    }
  }
}
