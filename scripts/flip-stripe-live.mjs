// One-shot: point production's Stripe env at live mode (preview stays sandbox).
import fs from "node:fs";

const envl = fs.readFileSync(".env.local", "utf8");
const g = (k) => {
  const m = envl.match(new RegExp(k + "=(\\S+)"));
  if (!m) throw new Error("missing " + k);
  return m[1];
};
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const vars = {
  STRIPE_SECRET_KEY: g("STRIPE_LIVE_SECRET_KEY"),
  STRIPE_PRICE_ID: g("STRIPE_LIVE_PRICE_ID"),
  STRIPE_SCAN_PACK_PRICE_ID: g("STRIPE_LIVE_PACK_PRICE_ID"),
  STRIPE_WEBHOOK_SECRET: g("STRIPE_LIVE_WEBHOOK_SECRET"),
};
for (const [key, value] of Object.entries(vars)) {
  const r = await fetch(
    "https://api.vercel.com/v10/projects/prj_GlXQxal5IAh2oG0zls2ZGjhK212b/env?teamId=team_l73XXJDNrLnYFezMhk8bn2K2&upsert=true",
    {
      method: "POST",
      headers: { authorization: "Bearer " + cfg.vercelToken, "content-type": "application/json" },
      body: JSON.stringify({ key, value, type: "encrypted", target: ["production"] }),
    },
  ).then((r) => r.json());
  console.log(key, r.error ? "ERROR " + r.error.message : "-> live (production only)");
}
