/**
 * One email address, and only one (09-30 review): the old signup check
 * /^\S+@\S+\.\S+$/ passed "a@x.com,b@y.com", which the mailer expands to
 * two recipients — so one signup could send our welcome mail to strangers.
 * No separators, quotes, brackets or spaces anywhere; one @; a dot in the
 * domain; 254 characters at most. Safe for client and server.
 * No empty part in the domain either (10-21: a bot signed up as
 * "admin@cardflip.io." and "admin@cardflip.io..", past the own-domain check).
 */
const EMAIL_RE = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\]+$/;

export function isValidEmail(email: string): boolean {
  if (email.length > 254 || !EMAIL_RE.test(email)) return false;
  return email.slice(email.indexOf("@") + 1).split(".").every((label) => label.length > 0);
}
