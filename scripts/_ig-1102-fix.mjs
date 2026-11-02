import fs from "node:fs";
import { createClient } from "@libsql/client";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^\uFEFF/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const write = process.argv[2] === "write";
const show = async () => {
  for (const r of (await db.execute("SELECT key, value FROM settings WHERE key IN ('social_slot:instagram:midday','social_kind:instagram:thennow','social_last_post:instagram:uris') ORDER BY key")).rows) console.log("  ", r.key, "=", r.value);
  for (const r of (await db.execute("SELECT site, url, format FROM social_post_log WHERE day = '2026-11-02' AND slot = 'midday' AND site = 'instagram'")).rows) console.log("  log:", r.url, r.format);
  for (const r of (await db.execute("SELECT url, game, format, kind, slot FROM social_posts WHERE site = 'instagram' AND post_id = '18121950598945755'")).rows) console.log("  posts:", JSON.stringify(r));
};
await show();
if (write) {
  const tx = await db.batch([
    { sql: "UPDATE social_post_log SET url = 'https://www.instagram.com/reel/DfP6xJrlEfK/', format = 'video' WHERE site = 'instagram' AND url = 'pending:2a5cb1b3-c95a-4b10-8d1f-88ffab50c58f:pokemon-thennow-2026-11-02'", args: [] },
    { sql: "UPDATE social_posts SET game = 'pokemon', format = 'video' WHERE site = 'instagram' AND post_id = '18121950598945755' AND (game IS NULL OR game = '')", args: [] },
    { sql: "INSERT INTO settings (key, value, updated_at) VALUES ('social_slot:instagram:midday', '2026-11-02', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", args: [Date.now()] },
    { sql: "INSERT INTO settings (key, value, updated_at) VALUES ('social_kind:instagram:thennow', '2026-11-02', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", args: [Date.now()] },
    { sql: "UPDATE settings SET value = ? WHERE key = 'social_last_post:instagram:uris' AND value NOT LIKE '%DfP6xJrlEfK%'", args: [JSON.stringify(['https://www.instagram.com/reel/DfPRC4-DBZ2/', 'https://www.instagram.com/reel/DfP6xJrlEfK/'])] },
  ], "write");
  console.log("rows changed:", tx.map((r) => r.rowsAffected).join(", "));
  await show();
}
