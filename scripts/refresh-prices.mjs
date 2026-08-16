/**
 * Run the daily price refresh by hand (same code the server runs):
 *   npm run refresh:prices           # Magic bulk refresh + Pokémon sweep, if due
 *   npm run refresh:prices -- --force
 * Useful for a first fill after a fresh sync, or to check Scryfall's bulk
 * download works from wherever this is run.
 */
const force = process.argv.includes("--force");
const { runDailyIfDue } = await import("../src/lib/server/dailyJobs.ts");
const r = await runDailyIfDue(force);
console.log(JSON.stringify(r, null, 2));
process.exit(0);
