/**
 * Apple's own network (AS714): 17.0.0.0/8 and these IPv6 blocks are Apple's alone. App Review tests from here, many
 * reviewers behind few addresses and sometimes from outside the open countries, so every per-network guard lets it
 * through: the country gate (proxy.ts, 10-30) and the sign-up guards (signupGuard.ts: the 3-a-day cap, the shut-out,
 * one free trial per network; 10-31, before resubmitting). Edge-safe: the proxy imports it.
 */
const APPLE_V6 = ["2620:149:", "2620:0149:", "2a01:b740:", "2403:300:", "2403:0300:"];

export function isAppleIp(ip: string | null | undefined): boolean {
  const s = (ip ?? "").trim().toLowerCase();
  if (/^(?:::ffff:)?17\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s)) return true;
  return APPLE_V6.some((p) => s.startsWith(p));
}
