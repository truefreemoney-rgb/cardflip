/**
 * Where CardFlip is open (Chris 09-30: "we are planning to use all the english
 * speaking countries"). Pure module: the proxy, route handlers and client
 * components all import it.
 *
 * ALLOWED_COUNTRIES (env, comma-separated ISO codes) overrides the default;
 * "*" turns the country gate off entirely (kill switch).
 */
export const DEFAULT_ALLOWED_COUNTRIES = ["US", "CA", "GB", "IE", "AU", "NZ"] as const;

export function allowedCountries(env: string | undefined = process.env.ALLOWED_COUNTRIES): Set<string> | "*" {
  const raw = (env ?? "").trim();
  if (raw === "*") return "*";
  const list = raw
    ? raw.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : [...DEFAULT_ALLOWED_COUNTRIES];
  return new Set(list);
}

export function isAllowedCountry(country: string | null | undefined, allowed = allowedCountries()): boolean {
  if (allowed === "*") return true;
  return Boolean(country) && allowed.has(country!.toUpperCase());
}

/** Display currency by HOME country (prices never change while travelling). */
export const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  GB: "GBP",
  IE: "EUR",
  AU: "AUD",
  NZ: "NZD",
};

export function currencyFor(country: string | null | undefined): string {
  return (country && COUNTRY_CURRENCY[country.toUpperCase()]) || "USD";
}

/** "Germany" for "DE"; falls back to the code if Intl has no name. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
