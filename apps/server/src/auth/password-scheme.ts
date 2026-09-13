/**
 * The registry of password hash schemes (ADR-011, patterns catalogue:
 * registry).
 *
 * A platform that stores passwords for years outlives the algorithm it
 * started with. Argon2id is right today; something will replace it, and when
 * it does every stored hash has to keep verifying while new ones are written
 * with the new scheme — there is no moment at which every password can be
 * re-hashed, because the plaintext only exists during a sign-in.
 *
 * So hashing is not one function but a set of schemes keyed by the identifier
 * the stored hash already carries. Every modern hash is a PHC string
 * (`$argon2id$v=19$m=…`), and the first field names the algorithm, so a
 * stored hash says which scheme wrote it and dispatch needs no extra column.
 *
 * Exactly one scheme is *current*: `hash` uses it, and anything written by a
 * different one is re-hashed on the owner's next sign-in, the same mechanism
 * that already migrates a hash written at weaker parameters.
 *
 * **Adding a scheme** is one file implementing `PasswordScheme` and one entry
 * in the list passed to `createPasswordSchemeRegistry` (see
 * `password.ts`); making it current is moving `current` to its identifier.
 *
 * **Retiring a scheme** is the operational step worth writing down, because
 * it is not symmetrical. Removing a scheme from the registry makes every hash
 * it wrote unverifiable, and `verify` fails closed — so the holders of those
 * hashes cannot sign in with a password again and must go through
 * `POST /api/auth/password-reset/request`. The order is: make the new scheme
 * current, wait long enough that the active population has signed in at least
 * once (the re-hash is automatic), check how many credentials still carry the
 * old identifier, and only then remove it — having first mailed the
 * stragglers a reset link. Removing a scheme is a breaking change to a
 * persisted format and takes a changelog entry saying so (ADR-033).
 */

export interface PasswordScheme {
  /**
   * The PHC prefix this scheme owns, dollars included: `$argon2id$`. It is
   * matched against the start of a stored hash, so it must be unambiguous
   * between schemes.
   */
  readonly id: string
  hash(plainText: string): Promise<string>
  verify(passwordHash: string, plainText: string): Promise<boolean>
  /**
   * Whether this scheme judges a hash it wrote to be below the parameters it
   * would use now. Only ever asked about a hash this scheme owns.
   */
  isWeaker(passwordHash: string): boolean
}

export interface PasswordSchemeRegistry {
  /** What `hash` uses, and what everything else is measured against. */
  readonly current: PasswordScheme
  /**
   * The scheme that wrote this hash, or null when nothing registered
   * recognises it — a hash from a scheme that has been retired, or a column
   * that holds something that is not a hash at all.
   */
  schemeFor(passwordHash: string): PasswordScheme | null
}

export function createPasswordSchemeRegistry(
  schemes: readonly PasswordScheme[],
  currentId: string,
): PasswordSchemeRegistry {
  const byId = new Map(schemes.map((scheme) => [scheme.id, scheme]))
  const current = byId.get(currentId)
  if (current === undefined) {
    throw new Error(`Password scheme "${currentId}" is not registered`)
  }
  if (byId.size !== schemes.length) {
    throw new Error('Two password schemes claim the same PHC identifier')
  }

  return {
    current,
    schemeFor(passwordHash: string): PasswordScheme | null {
      for (const scheme of byId.values()) {
        if (passwordHash.startsWith(scheme.id)) return scheme
      }
      return null
    },
  }
}
