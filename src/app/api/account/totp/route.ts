import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { AuthError, requireUser } from "@/lib/server/auth";
import { verifyPassword } from "@/lib/server/password";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { disableTotp, enableTotp, isDemoUser, setTotpBackupCodes, setTotpSecret, totpEnabled } from "@/lib/server/users";
import { generateBackupCodes, generateTotpSecret, otpauthUrl, verifyTotp } from "@/lib/server/totp";

/**
 * Two-step verification management, while signed in:
 *   POST {action:"setup"}                    → fresh secret + otpauth URL (QR)
 *   POST {action:"confirm", code}            → first code checks out → enabled
 *   POST {action:"backup-codes", password}   → a fresh set of eight one-time codes
 *   POST {action:"disable", password}        → off (password, not a code — a
 *     lost phone must not be able to keep the owner locked into 2FA, and a
 *     stolen session must not be able to quietly switch it off)
 * The demo account is shared, so it can never carry 2FA.
 */
export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`account:totp:${clientIp(req)}`, LIMITS.authAttempt);
  if (limited) return limited;
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't use two-step verification" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "setup") {
      if (totpEnabled(user)) {
        return NextResponse.json({ error: "Two-step verification is already on" }, { status: 400 });
      }
      const secret = generateTotpSecret();
      await setTotpSecret(user.id, secret);
      const url = otpauthUrl(user.email, secret);
      const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      return NextResponse.json({ secret, otpauthUrl: url, qrDataUrl });
    }

    if (action === "confirm") {
      const code = typeof body?.code === "string" ? body.code : "";
      if (!user.totpSecret || totpEnabled(user)) {
        return NextResponse.json({ error: "Start setup first" }, { status: 400 });
      }
      if (!verifyTotp(user.totpSecret, code)) {
        return NextResponse.json({ error: "That code didn't match — scan the QR again or wait for a fresh code" }, { status: 400 });
      }
      await enableTotp(user.id);
      // Backup codes (09-04): shown once, stored hashed; a lost phone is no
      // longer a hand-edited column.
      const backup = generateBackupCodes();
      await setTotpBackupCodes(user.id, backup.hashes);
      return NextResponse.json({ ok: true, backupCodes: backup.codes });
    }

    if (action === "backup-codes") {
      const password = typeof body?.password === "string" ? body.password : "";
      if (!totpEnabled(user)) {
        return NextResponse.json({ error: "Two-step verification is off" }, { status: 400 });
      }
      if (!verifyPassword(password, user.passwordHash)) {
        return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
      }
      const backup = generateBackupCodes();
      await setTotpBackupCodes(user.id, backup.hashes);
      return NextResponse.json({ ok: true, backupCodes: backup.codes });
    }

    if (action === "disable") {
      const password = typeof body?.password === "string" ? body.password : "";
      if (!verifyPassword(password, user.passwordHash)) {
        return NextResponse.json({ error: "Password is incorrect" }, { status: 400 });
      }
      await disableTotp(user.id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
