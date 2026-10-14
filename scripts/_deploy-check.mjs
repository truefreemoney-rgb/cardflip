// Read-only: latest production deployments on Vercel (state + commit). 10-13.
import fs from "node:fs";
const m = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const r = await fetch("https://api.vercel.com/v6/deployments?teamId=team_l73XXJDNrLnYFezMhk8bn2K2&projectId=prj_GlXQxal5IAh2oG0zls2ZGjhK212b&limit=3&target=production", { headers: { Authorization: `Bearer ${m.vercelToken}` } });
const j = await r.json();
for (const d of j.deployments ?? []) console.log(d.state, d.meta?.githubCommitSha?.slice(0, 8), new Date(d.created).toISOString(), d.uid);
