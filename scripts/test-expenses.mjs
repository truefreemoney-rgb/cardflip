/**
 * Expense rows for the admin Money section (lib/expenses.ts).
 * Run: npm run test:expenses
 *
 * Pins: cleaning drops nameless / negative / NaN rows and rounds to cents;
 * unknown periods fall back to monthly; ids derive from the name; the
 * monthly total counts yearly rows at a twelfth and one-offs not at all.
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { normalizeExpense, monthlyTotal, perMonth } = await import(at("lib/expenses.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got      ${JSON.stringify(actual)}\n        expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

console.log("normalizeExpense");
check("nameless row dropped", normalizeExpense({ name: "  ", amountUsd: 5 }), null);
check("negative dropped", normalizeExpense({ name: "x", amountUsd: -1 }), null);
check("NaN dropped", normalizeExpense({ name: "x", amountUsd: "abc" }), null);
check("string amount accepted and rounded", normalizeExpense({ name: "Vercel Pro", amountUsd: "19.999" }), { id: "vercel-pro", name: "Vercel Pro", amountUsd: 20, period: "month", confirmed: false });
check("bad period → month, confirmed only when true", normalizeExpense({ id: "t", name: "Turso", amountUsd: 5.99, period: "weekly", confirmed: "yes" }).period, "month");
check("note kept, trimmed", normalizeExpense({ name: "Domain", amountUsd: 35, period: "year", note: "  renewal " }).note, "renewal");
check("empty note omitted", "note" in normalizeExpense({ name: "Domain", amountUsd: 35, note: "" }), false);

console.log("monthly math");
const rows = [
  { id: "a", name: "Vercel", amountUsd: 20, period: "month", confirmed: true },
  { id: "b", name: "Domain", amountUsd: 36, period: "year", confirmed: true },
  { id: "c", name: "X credits", amountUsd: 5, period: "once", confirmed: true },
];
check("per month: month / year÷12 / once=0", rows.map(perMonth), [20, 3, 0]);
check("total excludes one-offs", monthlyTotal(rows), 23);
check("total rounds to cents", monthlyTotal([{ id: "a", name: "a", amountUsd: 10, period: "year", confirmed: true }]), 0.83);
check("empty list is zero", monthlyTotal([]), 0);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
