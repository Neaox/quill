/**
 * The canonical form of an email address (ADR-011).
 *
 * Everything the auth flows do with an address — look it up, create an
 * account for it, rate-limit it, send to it — uses this form, and the
 * database holds a unique index on `lower(email)` to make it true of rows
 * already stored. Without it, `Ada@example.com` and `ada@example.com` are two
 * accounts for one mailbox: the existing-account protection that keeps
 * sign-up from enumerating never fires across casings, a reset link goes to
 * whichever of the two the requester happened to spell, and a rate-limit
 * budget multiplies by however many spellings an attacker can think of.
 *
 * Only case and surrounding whitespace are normalised. Provider-specific
 * folding — dots in a Gmail local part, `+` tags — is deliberately *not*
 * done: those rules differ per provider, change without notice, and applying
 * them would merge addresses that are genuinely distinct elsewhere.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}
