/**
 * One email address, and only one (09-30 review): the old signup check
 * /^\S+@\S+\.\S+$/ passed "a@x.com,b@y.com", which the mailer expands to
 * two recipients — so one signup could send our welcome mail to strangers.
 * No separators, quotes, brackets or spaces anywhere; one @; a dot in the
 * domain; 254 characters at most. Safe for client and server.
 */
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}
