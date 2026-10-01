/**
 * The one place the password length rules live; signup, reset, change and
 * admin create (routes and their forms) all read these.
 *
 * The minimum was 6 until 10-01 (Chris, after the sweep: 8). It applies to
 * NEW passwords only: login never checks length, so an account with an older
 * 6- or 7-character password keeps signing in until it next changes it.
 */
export const PASSWORD_MIN = 8;
/** Hashing cost grows with the input; nothing longer is ever stored. */
export const PASSWORD_MAX = 200;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return "That password is too long.";
  return null;
}
