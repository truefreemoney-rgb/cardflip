/**
 * "Did you mean …@icloud.com?" under the signup email box (10-07: an ad signup
 * typed @iclod.org, the welcome email bounced and they had to sign up again).
 * Pure, no I/O: scripts/test-email-typo.mjs runs it directly.
 */
const DOMAINS = [
  "gmail.com",
  "icloud.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "live.com",
  "msn.com",
  "me.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "protonmail.com",
  "ymail.com",
  // Real providers that sit one letter from a bigger one (mail ~ gmail): listed so they're left alone.
  "mail.com",
  "gmx.com",
  "zoho.com",
];

/** Edit distance, capped: anything over `max` returns max + 1. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** The corrected address, or null when the domain looks fine or isn't close to a common one. */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (DOMAINS.includes(domain)) return null;
  const name = domain.split(".")[0];
  const ending = domain.slice(name.length + 1);
  // Country versions are real (hotmail.co.uk, yahoo.ca, live.com.au; eBay GB/IE/AU/CA are on):
  // keep the ending and only fix a misspelled name.
  const country = ending.includes(".") || (ending.length === 2 && ending !== "co");
  // Right name, wrong ending: icloud.org / gmail.co / yahoo.con.
  const sameName = DOMAINS.find((d) => d.split(".")[0] === name);
  if (sameName) return country ? null : `${local}@${sameName}`;
  // Misspelled name, any ending (iclod.org, gmial.com): compare the part before the first dot.
  // Short names (aol, msn, me) allow 1 slip, longer ones 2.
  let best: string | null = null;
  let bestD = 3;
  for (const d of DOMAINS) {
    const dName = d.split(".")[0];
    const max = dName.length <= 4 ? 1 : 2;
    const dist = distance(name, dName, max);
    if (dist <= max && dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  if (!best) return null;
  return country ? `${local}@${best.split(".")[0]}.${ending}` : `${local}@${best}`;
}
