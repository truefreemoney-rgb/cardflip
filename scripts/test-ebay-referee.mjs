/**
 * The nightly eBay referee's matcher and rule (lib/ebayReferee.ts). Run: npm run test:ebayreferee
 *
 * Every title below is a real eBay listing title from the 10-13 calibration
 * (58 cards whose truth came from eBay SOLD listings of the exact printing and
 * finish). Each pin is a mistake the first prototype made, or a card the rule
 * must catch or must leave alone.
 */
const { refereeMatcher, refereeQueries, summarizeAsks, refereeVerdict, EBAY_REFEREE, trustedSeller, measureSellerFloor } = await import(new URL("../src/lib/ebayReferee.ts", import.meta.url).href);

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
const reading = (prices, played = []) => ({ n: prices.length + played.length, nNm: prices.length, median: [...prices].sort((a, b) => a - b)[Math.floor((prices.length - 1) / 2)] ?? null, q75: [...prices].sort((a, b) => a - b)[Math.floor((prices.length - 1) * 0.75)] ?? null });

console.log("Magic: special printings");
{
  const aang = refereeMatcher({ game: "mtg", cardId: "a", variant: "foil", name: "Avatar Aang // Aang, Master of Elements", number: "363", setName: "Avatar: The Last Airbender", setCode: "tla", promoTypes: "headliner,raisedfoil,universesbeyond,boosterfun", finishes: "foil" });
  check("raised-foil Avatar Aang matches its raised-foil listing", aang("Avatar Aang (Raised Foil) 363 Avatar: The Last Airbender MAGIC: THE GATHERING"));
  check("... not a regular copy (the live comps matcher priced it off $0.99 copies)", aang("Avatar Aang Avatar The Last Airbender NM"), false);
  check("... not a PSA 10", aang("2025 MTG Avatar: The Last Airbender Aang #0363 Headliner Raised Foil PSA 10"), false);
  check("... not a PSA9 / BGS9.5 written without a space", [aang("Avatar Aang 363 Raised Foil PSA9"), aang("Avatar Aang 363 Raised Foil BGS9.5")], [false, false]);

  const ff = refereeMatcher({ game: "mtg", cardId: "f", variant: "foil", name: "Final Fortune", number: "182★", setName: "Seventh Edition", setCode: "7ed", promoTypes: "", finishes: "foil" });
  check("Seventh Edition ★ is the foil: a foil listing matches", ff("MTG - Final Fortune - Foil Seventh Edition"));
  check("... a non-foil 7th Edition copy does not (the prototype read $12 copies)", ff("Final Fortune 7th Edition MTG"), false);

  const mind = refereeMatcher({ game: "mtg", cardId: "m", variant: "foil", name: "The Mind Stone", number: "386", setName: "Marvel Super Heroes", setCode: "msh", promoTypes: "universesbeyond", finishes: "foil", borderColor: "borderless" });
  check("an Art Series card is not the card", mind("MTG The Mind Stone Art Card Art Series: Marvel Super Heroes"), false);
  check("a borderless printing needs 'borderless' or its number", mind("Mind Stone Foil GameStop Promo MTG Magic The Gathering Marvel"), false);
  check("... and matches with it", mind("The Mind Stone (Borderless) Marvel Super Heroes Foil"));

  const leg = refereeMatcher({ game: "yugioh", cardId: "ygo-22150-1st", variant: "normal", name: "Left Leg of the Forbidden One", number: "LOB-121", setName: "The Legend of Blue Eyes White Dragon", firstEdition: true, printing: "" });
  check("YGO: the original LOB-121 1st matches", leg("YU-GI-OH 2002 Left Leg Of The Forbidden One LOB-121 Ultra Rare 1st Edition"));
  check("YGO: its 25th Anniversary reprint LOB-EN121 does not", [leg("Left Leg of the Forbidden One LOB-EN121 1st Edition Ultra Rare"), leg("Left Leg of the Forbidden One LOB-121 25th Anniversary 1st Edition")], [false, false]);
  const celebi = refereeMatcher({ game: "pokemon", cardId: "neo4-106", variant: "unlimitedHolofoil", name: "Shining Celebi", number: "106", setName: "Neo Destiny" });
  check("30th Celebration reprints are not the original", [celebi("30th Celebration Shining Celebi 106/105 Neo Destiny Secret Rare Holo English"), celebi("2026 Pokemon 30th Celebration Shining Celebi Classic [Neo Destiny] #106/105")], [false, false]);
  check("... the original still matches", celebi("Shining Celebi 106/105 Neo Destiny Holo Unlimited"));
  check("a card FROM a Celebrations set still matches its own titles", refereeMatcher({ game: "pokemon", cardId: "cel25c-4_A", variant: "holofoil", name: "Charizard", number: "4", setName: "Celebrations: Classic Collection" })("Charizard 4/102 Celebrations Classic Collection Holo"));
  const pz = refereeMatcher({ game: "pokemon", cardId: "sm9-184", variant: "holofoil", name: "Pikachu & Zekrom GX", number: "184", setName: "Team Up" });
  check("fakes: 'Collectable Pokemon ... Rainbow' and 'Fan Art' are not the card", [pz("Collectable Pokemon Pikachu & Zekrom GX 184/181 Team Up Secret Rare Rainbow"), pz("Nintendo Pokemon Pikachu & Zekrom GX Team Up Gold Foil Fan Art Card 184/181")], [false, false]);
  check("... a real one still matches", pz("Pikachu & Zekrom GX (Secret) 184/181 Sm-Team Up Holo - NM/M"));

  // 10-18 hand check: treatments the plain printing does not have must be named, or the listing carries the number.
  const spidey = refereeMatcher({ game: "mtg", cardId: "sp", variant: "foil", name: "Spectacular Spider-Man", number: "238", setName: "Marvel's Spider-Man", setCode: "spm", promoTypes: "textured,universesbeyond,boosterfun", finishes: "foil", borderColor: "borderless" });
  check("textured: the borderless #14 is not the textured #238", spidey("MTG Spectacular Spider-Man (Borderless Foil) Marvel's Spider-Man 14 NM"), false);
  check("textured: 'textured' in the title matches", spidey("2025 MTG Marvel's Spider-Man Borderless Textured Foil Spectacular Spider-Man"));
  check("textured: its own number matches without the word", spidey("2025 Magic MTG Marvel's Spider-Man Spectacular Foil #0238"));
  const elves = refereeMatcher({ game: "mtg", cardId: "le", variant: "foil", name: "Llanowar Elves", number: "429", setName: "Foundations", setCode: "fdn", promoTypes: "japanshowcase,boosterfun", finishes: "foil" });
  check("Japan showcase: a plain Foundations foil is not #429", elves("LLANOWAR ELVES FOIL NM MAGIC: THE GATHERING FOUNDATIONS"), false);
  check("Japan showcase: '(Showcase) -Foil' matches", elves("Llanowar Elves (Showcase) -Foil Near Mint MTG Foundations"));
  check("Japan showcase: 'Japan Showcase' in the title is the printing, not the language", elves("Llanowar Elves Japan Showcase Foil #429 Foundations MTG NM"));
  check("Japan showcase: a Japanese-language copy still drops", elves("Llanowar Elves Japanese Japan Showcase Foil #429 Foundations"), false);
  const plainElves = refereeMatcher({ game: "mtg", cardId: "le2", variant: "foil", name: "Llanowar Elves", number: "227", setName: "Foundations", setCode: "fdn", promoTypes: "", finishes: "foil,nonfoil" });
  check("Japan showcase: words in a plain printing's listing still read as Japanese", plainElves("Llanowar Elves Japan Showcase Foil Foundations 227"), false);

  const kaldra = refereeMatcher({ game: "mtg", cardId: "k", variant: "foil", name: "Kaldra Compleat", number: "2", setName: "Spotlight Series", setCode: "pspl", promoTypes: "", finishes: "nonfoil,foil" });
  check("'Horizons 2' is not collector number 2", kaldra("Kaldra Compleat (Showcase) Modern Horizons 2 Foil"), false);

  const fury = refereeMatcher({ game: "mtg", cardId: "fu", variant: "foil", name: "Fury", number: "7007", setName: "Secret Lair Drop", setCode: "sld", promoTypes: "sldbonus,ffx,universesbeyond", finishes: "foil", flavorName: "Ifrit" });
  check("'Unleash Fury' is not Fury", fury("Unleash Fury (Rainbow Foil) Secret Lair Drop Foil"), false);
  check("... Ifrit (its flavor name) is", fury("Ifrit - Fury 7007 (Rainbow Foil) Secret Lair"));

  const port = refereeMatcher({ game: "mtg", cardId: "p", variant: "foil", name: "Rishadan Port", number: "324", setName: "Mercadian Masques", setCode: "mmq", promoTypes: "", finishes: "nonfoil,foil" });
  check("a damaged copy is not compared with a Near Mint price", port("Rishadan Port - Foil Damaged, English Mercadian Masques MTG"), false);
  check("a Secret Lair title is fine (the comps matcher drops every one)", refereeMatcher({ game: "mtg", cardId: "s", variant: "foil", name: "Subtlety", number: "7005", setName: "Secret Lair Drop", setCode: "sld", promoTypes: "sldbonus", finishes: "foil", flavorName: "Shiva" })("Shiva - Subtlety (Rainbow Foil) -Foil Near Mint MTG Secret Lair"));
}

console.log("Pokemon / Yu-Gi-Oh! / One Piece / Lorcana");
{
  const lc = refereeMatcher({ game: "pokemon", cardId: "lc-3", variant: "holofoil", name: "Charizard", number: "3", setName: "Legendary Collection", setTotal: 110 });
  check("the holo matches", lc("2002 Pokemon Legendary Collection Charizard #3/110 Holo NM/LP"));
  check("... the reverse holo does not", lc("Charizard 3/110 Legendary Collection Reverse Holo"), false);
  check("... the non-holo deck card does not", lc("Charizard (WotC Legendary Collection) 3/110 Deck Exclusives Regular"), false);
  const mew = refereeMatcher({ game: "pokemon", cardId: "lc-29", variant: "reverseHolofoil", name: "Mewtwo", number: "29", setName: "Legendary Collection", setTotal: 110 });
  check("the reverse holo needs 'reverse'", [mew("Mewtwo 29/110 Legendary Collection Reverse Holo"), mew("Mewtwo 29/110 Legendary Collection Holo")], [true, false]);
  const mcz = refereeMatcher({ game: "pokemon", cardId: "xy2-108", variant: "holofoil", name: "M Charizard EX", number: "108", setName: "Flashfire", setTotal: 106 });
  check("fan-made and gold-foil fakes are out", [mcz("M Charizard EX (X) (Secret) 108/106 Flashfire Holo fan made card"), mcz("Pokemon M CHARIZARD EX 108/106 GOLD FOIL FLASHFIRE")], [false, false]);

  const witch = refereeMatcher({ game: "yugioh", cardId: "ygo-714628-1st", variant: "normal", name: "Cyberse Contract Witch", number: "MAMO-EN018", setName: "Magnificent Monsters", firstEdition: true });
  check("the 1st Edition print code matches", witch("Cyberse Contract Witch - MAMO-EN018 - Ultra Rare - 1st Edition - YuGiOh"));
  check("... an unlimited copy does not", witch("Cyberse Contract Witch MAMO-EN018 Magnificent Monsters Yu-Gi-Oh"), false);
  const rainbow = refereeMatcher({ game: "yugioh", cardId: "ygo-205774", variant: "normal", name: "Rainbow Dragon", number: "TAEV-EN006", setName: "Tactical Evolution", rarity: "Ghost Rare", printing: "chaos-neos-misprint" });
  check("the misprint needs 'misprint', and the ghost rare 'ghost'", [rainbow("Yu-Gi-Oh! Rainbow Dragon Ghost Rare Chaos Neos Misprint TAEV-EN006"), rainbow("Rainbow Dragon (Ghost Rare) TAEV-EN006 Tactical Evolution Unlimited")], [true, false]);

  const kuzan = refereeMatcher({ game: "onepiece", cardId: "OP16-063_p2", variant: "normal", name: "Kuzan", number: "OP16-063", setName: "The Time of Battle", printing: "manga" });
  check("One Piece manga art needs 'manga'", [kuzan("Kuzan (Manga) OP16-063 The Time of Battle Foil"), kuzan("Kuzan OP16-063 The Time of Battle Rare")], [true, false]);
  check("... a keychain is not a card", kuzan("Bandai One Piece TCG Kuzan OP16-063 (Manga) Novelty Keychain"), false);

  const buzz = refereeMatcher({ game: "lorcana", cardId: "b", variant: "foil", name: "Buzz Lightyear", subtitle: "Jungle Ranger", number: "241", setName: "Wilds Unknown", rarity: "Iconic" });
  check("Lorcana iconic: name + subtitle + number + 'iconic'", [buzz("Disney Lorcana: Set 12 Buzz Lightyear - Jungle Ranger ICONIC Foil 241/204 EN"), buzz("Buzz Lightyear Jungle Ranger 241/204 Lorcana")], [true, false]);

  const { refereeable } = await import(new URL("../src/lib/ebayReferee.ts", import.meta.url).href);
  check("a printing tag the matcher can't require is not refereed (Magnificent Monsters 'gmr' read against $3 ultra rares, 10-13)", refereeable({ game: "yugioh", cardId: "g", variant: "normal", name: "Cyberse Contract Witch", number: "MAMO-EN018", setName: "Magnificent Monsters", printing: "gmr" }), false);
  check("a lettered Magic number with no named treatment is not refereed (Cavern of Souls 410a), a serialized one is", [refereeable({ game: "mtg", cardId: "c", variant: "foil", name: "Cavern of Souls", number: "410a", setName: "The Lost Caverns of Ixalan", promoTypes: "" }), refereeable({ game: "mtg", cardId: "k", variant: "foil", name: "Krenko, Mob Boss", number: "335z", setName: "Ravnica Remastered", promoTypes: "serialized,doublerainbow" })], [false, true]);
  check("... nor a prize-card set (a YCS prize card has no liquid market)", refereeable({ game: "yugioh", cardId: "p", variant: "normal", name: "Minerva", number: "YCSW-EN008", setName: "Yu-Gi-Oh! Championship Series Prize Cards", printing: "" }), false);
  check("One Piece: only the base printing is read (every version shares one code)", [refereeable({ game: "onepiece", cardId: "o", variant: "normal", name: "Monkey.D.Luffy", number: "OP05-119", setName: "Awakening of the New Era", printing: "manga" }), refereeable({ game: "onepiece", cardId: "o2", variant: "normal", name: "Monkey.D.Luffy", number: "OP05-119", setName: "Awakening of the New Era", printing: "" })], [false, true]);
  check("... while a known tag and Magic / Pokemon are", [refereeable({ game: "yugioh", cardId: "u", variant: "normal", name: "Cyber End Dragon", number: "CRV-EN036", setName: "Cybernetic Revolution", printing: "utr" }), refereeable({ game: "mtg", cardId: "m", variant: "foil", name: "X", number: "1", setName: "Y" })], [true, true]);
  const luffy = refereeMatcher({ game: "onepiece", cardId: "OP05-119", variant: "normal", name: "Monkey.D.Luffy", number: "OP05-119", setName: "Awakening of the New Era", printing: "" });
  check("One Piece base printing: a title naming a treatment is another printing", [luffy("Monkey.D.Luffy OP05-119 SEC Awakening of the New Era"), luffy("Monkey.D.Luffy OP05-119 Manga Alt Art"), luffy("Luffy OP05-119 SP Gold")], [true, false, false]);
  const arielBase = refereeMatcher({ game: "lorcana", cardId: "a", variant: "normal", name: "Ariel", subtitle: "Adventurous Collector", number: "33", setName: "Fabled", rarity: "Legendary" });
  check("Lorcana regular card: its enchanted version is another printing", arielBase("Ariel Adventurous Collector 33 Enchanted"), false);

  check("queries: Yu-Gi-Oh! leads with the print code, Lorcana carries the game word", [refereeQueries({ game: "yugioh", cardId: "x", variant: "normal", name: "Necroface", number: "GLAS-EN090", setName: "Gladiator's Assault" })[0], refereeQueries({ game: "lorcana", cardId: "y", variant: "foil", name: "Ariel", subtitle: "Adventurous Collector", number: "232", setName: "Fabled" })[0]], ["GLAS-EN090 Necroface", "Ariel Adventurous Collector 232 lorcana"]);
}

console.log("summarizeAsks");
{
  const lugia = { game: "pokemon", cardId: "ex10-105", variant: "holofoil", name: "Lugia ex", number: "105", setName: "Unseen Forces" };
  const r = summarizeAsks(lugia, [{ title: "Lugia ex 105/115 EX Unseen Forces Holo", price: 750 }, { title: "Lugia ex 105/115 Unseen Forces Holo LP", price: 540 }]);
  check("the 'ex' in 'Lugia ex' is the card's name, not a condition (the prototype dropped every Lugia ex ask)", [r.n, r.nNm], [2, 1]);
  check("played copies stay out of the NM figures", r.median, 750);
}

console.log("refereeVerdict (the 10-13 calibration cards)");
{
  check("Cyberse Contract Witch 1st, $68,000, 111 asks around $4: high", refereeVerdict(68000, { n: 112, nNm: 111, median: 4.01, q75: 12.99 }).verdict, "high");
  check("Genex Ally Axel, $213,589, one $1.99 ask: high (100x+ even alone)", refereeVerdict(213589.17, { n: 1, nNm: 1, median: 1.99, q75: 1.99 }).verdict, "high");
  check("Necroface 1st, $900 vs two asks at $340: a hand check (two asks are too few to hide on)", refereeVerdict(899.97, { n: 2, nNm: 2, median: 340, q75: 340 }).verdict, "check");
  check("Rayquaza ex, $999 (sells $950-1,200): ok", refereeVerdict(999, { n: 17, nNm: 14, median: 1000, q75: 1999.99 }).verdict, "ok");
  check("Kuzan manga, $1,088 vs asks ~$1,000: ok", refereeVerdict(1088.18, { n: 29, nNm: 29, median: 999.99, q75: 1305.84 }).verdict, "ok");
  check("Black Kyurem-EX, $901 vs median $450 / upper $650: check, not hidden", refereeVerdict(900.96, { n: 42, nNm: 28, median: 450, q75: 650 }).verdict, "check");
  check("a single cheap ask (a mispriced $11.99 neon ink Aang) never hides a $611 card: a hand check", refereeVerdict(611.4, reading([11.99])).verdict, "check");
  check("... unless 100x+", refereeVerdict(611.4, reading([5.99])).verdict, "high");
  check("asks reaching the price keep it off the hide list (manga Gol.D.Roger $5,500: median $290, upper $7,000): check", refereeVerdict(5500, { n: 13, nNm: 13, median: 290, q75: 7000 }).verdict, "check");
  check("vintage needs 3x and 3 asks: a $1,300 1st Edition Neo Genesis Lugia against two $430 asks is a hand check, not hidden", refereeVerdict(1300, { n: 2, nNm: 2, median: 429.95, q75: 429.95, vintage: true }).verdict, "check");
  check("... a $1,050 Mewtwo delta reverse holo (sold $760-1,000) against asks of $400-425: check", refereeVerdict(1050, { n: 6, nNm: 6, median: 400, q75: 425, vintage: true }).verdict, "check");
  check("... while Tower of Babel ($5,020 common against $1.74 asks) is still hidden", refereeVerdict(5019.94, { n: 38, nNm: 38, median: 1.39, q75: 1.74, vintage: true }).verdict, "high");
  check("summarizeAsks marks a pre-2010 print vintage", summarizeAsks({ game: "pokemon", cardId: "x", variant: "holofoil", name: "Lugia", number: "9", setName: "Neo Genesis", releaseDate: "2000/12/16" }, [{ title: "Lugia 9/111 Neo Genesis Holo", price: 500 }]).vintage, true);
  check("nothing listed: none", refereeVerdict(500, { n: 0, nNm: 0, median: null, q75: null }).verdict, "none");
  check("only played copies listed: none", refereeVerdict(925, { n: 1, nNm: 0, median: null, q75: null }).verdict, "none");
  check("thresholds are the calibrated ones", [EBAY_REFEREE.minUsd, EBAY_REFEREE.overUpper, EBAY_REFEREE.minAsks, EBAY_REFEREE.absurd, EBAY_REFEREE.overMedian], [100, 1.5, 3, 100, 1.5]);
}

console.log("seller floor (TASKS C1.4, 10-22: measured beside the real reading, not applied)");
{
  check("floor is 95% positive and 20 feedbacks", [EBAY_REFEREE.sellerMinPct, EBAY_REFEREE.sellerMinScore], [95, 20]);
  check("a 3-feedback seller at 0% (the $2,800 'NM' Rayquaza ex) is under the floor", trustedSeller({ pct: 0, score: 3 }), false);
  check("an 82-feedback seller at 80% is under it too", trustedSeller({ pct: 80, score: 82 }), false);
  check("a 19-feedback seller at 100% is under (too few feedbacks)", trustedSeller({ pct: 100, score: 19 }), false);
  check("a 20-feedback seller at 95% is on the floor: kept", trustedSeller({ pct: 95, score: 20 }));
  check("no seller on the summary: kept (older summaries)", [trustedSeller(null), trustedSeller(undefined)], [true, true]);
  check("only one figure known: judged on that one", [trustedSeller({ pct: null, score: 5 }), trustedSeller({ pct: 99.8, score: null })], [false, true]);
  const m = measureSellerFloor([
    { verdict: "ok", floor: { asks: 6, dropped: 2, verdict: "high" } },
    { verdict: "ok", floor: { asks: 4, dropped: 0, verdict: "ok" } },
    { verdict: "check", floor: { asks: 3, dropped: 1, verdict: "check" } },
    { verdict: "check" }, // a hand-only row: no measure
    { verdict: "none", floor: { asks: 1, dropped: 1, verdict: "none" } },
  ]);
  check("run summary: asks, dropped, cards touched", [m.asks, m.dropped, m.cardsTouched], [14, 4, 3]);
  check("... verdict counts with the floor on", m.verdicts, { high: 1, check: 1, ok: 1, none: 1 });
  check("... flips keyed from>to", m.flips, { "ok>high": 1 });
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
