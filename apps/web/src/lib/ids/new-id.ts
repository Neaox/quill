/**
 * The web app's one source of fresh identifiers, so the seam exists in one place rather than
 * `crypto.randomUUID()` appearing in a component, where a test cannot pin it. (It is allowed
 * here by name in `.oxlintrc.json`, as `lib/time/clock.ts` is for the clock.)
 */
export function newId(): string {
  return globalThis.crypto.randomUUID()
}
