// Yu-Gi-Oh tokens that TCGplayer has no scan of and YGOPRODeck does not list by name (10-01):
// the "Token: character & monster" cards pulled from 2025-26 boosters (printed TKN5-EN...) and
// OTS Tournament Pack 26's Bomb Token. Yugipedia has the English print of each; copied into
// public/catalog/yugioh (480px, never hotlinked) and added to scripts/yugioh-own-pictures.json,
// the map deadPictureStandIns reads as the last resort.
//
//   node scripts/fill-yugioh-yugipedia-pictures.mjs [--dry]
//   (push, wait for the deploy to serve the files)
//   node scripts/repoint-dead-pictures.mjs --prod
//
// Left out on purpose (only a Japanese or a different English print exists there, checked 10-01;
// Chris: "wait for english"): the Beyond the Brave tokens Aster / Gong Strong / Kalin / Nash
// (Joey found 10-03 via its Legendary Decks II print), Audhumla (SAMPLE stamp everywhere incl.
// Konami's DB, 10-03), Clown Crew Cappello (Japanese only). Add them once an English scan exists;
// English release is 2026-10-09.
// Fairy Tale Tails (UP01): the only English scan is the Ghosts From the Past print, which carries
// the card's OLD printed name, "Fairy Tail Tales". Not a stand-in for a row named the new way.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const dry = process.argv.includes("--dry");
const SITE = "https://cardflip.io";
const DIR = path.join(root, "public", "catalog", "yugioh");
const MAP = path.join(root, "scripts", "yugioh-own-pictures.json");
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io; support@cardflip.io)" };

// Catalog card name -> Yugipedia file.
const T = (who) => `Token-TKN5-EN-SR-UE-${who}.png`;
const PICTURES = {
  "Bomb Token": "BombToken-OP26-EN-SR-UE.png",
  // TKN4-EN013, the row TCGplayer calls "red". Not the three OP09 tokens (Dracossack / Harrliard / Megaraptor), which have their own rows.
  "Token: Mecha Phantom Beast": "Token-TKN4-EN-SR-UE-MechaPhantomBeast.png",
  "Token: Alexis & Cyber Angel Dakini": T("AlexisandCyberAngelDakini"),
  'Token: Aporia and "Meklord Astro Mekanikle"': T("AporiaandMeklordAstroMekanikle"),
  "Token: Blue Gal & Trickstar Band Sweet Guitar": T("BlueGalandTrickstarBandSweetGuitar"),
  "Token: Declan & D/D/D Doom King Armageddon": T("DeclanandDDDDoomKingArmageddon"),
  'Token: Ghost Gal and "Altergeist Primebanshee"': T("GhostGalandAltergeistPrimebanshee"),
  "Token: Kaiba & Blue-Eyes Ultimate Dragon": T("KaibaandBlueEyesUltimateDragon"),
  'Token: Kite and "Number 62: Galaxy-Eyes Prime Photon Dragon"': T("KiteandNumber62GalaxyEyesPrimePhotonDragon"),
  "Token: Leo & Life Stream Dragon": T("LeoandLifeStreamDragon"),
  "Token: Pegasus & Toon Summoned Skull": T("PegasusandToonSummonedSkull"),
  "Token: Shark & Number 32: Shark Drake": T("SharkandNumber32SharkDrake"),
  "Token: Supreme King Jaden & Supreme King's Castle": T("SupremeKingJadenandSupremeKingsCastle"),
  "Token: The Gore & Gouki The Great Ogre": T("TheGoreandGoukiTheGreatOgre"),
  "Token: Vizor & T.G. Blade Blaster": T("VizorandTGBladeBlaster"),
  "Token: Yuma & Number F0: Utopic Future": T("YumaandNumberF0UtopicFuture"),
  "Token: Yusei & Junk Warrior": T("YuseiandJunkWarrior"),
  'Token: Yuto and "Dark Rebellion Xyz Dragon"': T("YutoandDarkRebellionXyzDragon"),
  "Token: Yuya & Performapal Show Down": T("YuyaandPerformapalShowDown"),
  // 10-03: Yugipedia has no TKN5 English scan of the Beyond the Brave Joey token yet, but the
  // same token (same page, same art) was printed in English in Legendary Decks II (LDK2-ENT03).
  "Token: Joey and Red-Eyes Black Dragon": "Token-LDK2-EN-UR-LE-JoeyandRedEyesBlackDragon.png",
};

const own = JSON.parse(fs.readFileSync(MAP, "utf8"));
const todo = Object.entries(PICTURES).filter(([name]) => !own[name]);
const info = await (await fetch("https://yugipedia.com/api.php?" + new URLSearchParams({ format: "json", action: "query", prop: "imageinfo", iiprop: "url", titles: todo.map(([, f]) => `File:${f}`).join("|") }), { headers: HEADERS })).json();
const urlOf = new Map(Object.values(info.query?.pages ?? {}).map((p) => [p.title.replace("File:", "").replace(/ /g, "_"), p.imageinfo?.[0]?.url]));

if (!dry) fs.mkdirSync(DIR, { recursive: true });
let added = 0;
for (const [name, source] of todo) {
  const url = urlOf.get(source);
  if (!url) { console.log(`  !! ${name}: Yugipedia has no ${source}`); process.exitCode = 1; continue; }
  const file = source.replace(/\.png$/, ".jpg").toLowerCase();
  if (!dry) {
    await new Promise((r) => setTimeout(r, 1100));
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!res.ok) { console.log(`  !! ${name}: ${res.status}`); process.exitCode = 1; continue; }
    await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 480, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(DIR, file));
    own[name] = `${SITE}/catalog/yugioh/${file}`;
  }
  added++;
}
if (!dry) fs.writeFileSync(MAP, JSON.stringify(Object.fromEntries(Object.entries(own).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n");
console.log(`${dry ? "would add" : "added"} ${added} of ${todo.length}`);
