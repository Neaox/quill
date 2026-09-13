/**
 * Secrets entered in the product — OIDC client secrets, integration tokens,
 * webhook signing keys, an SMTP password an administrator supplies — under
 * envelope encryption (ADR-034, ADR-011).
 *
 * Each secret is encrypted with its own **data key**, and the data key is
 * wrapped by a **master key the application never stores**. Three
 * consequences fall out, and they are the reason for the shape of these
 * ports:
 *
 * - Rotating the master key re-wraps data keys and never touches ciphertext,
 *   so rotation is cheap however large a secret is.
 * - Every row records the key id it was wrapped with, so a rotation can be
 *   interrupted and resumed and a half-rotated table still reads.
 * - The master key can live somewhere that never hands it over. `wrap` and
 *   `unwrap` are the boundary rather than "give me the key", because that is
 *   exactly the shape AWS KMS, Google Cloud KMS, Azure Key Vault, and Vault
 *   offer; an environment or key-file provider implements them locally.
 *
 * A secret is decrypted only at the moment of use, is never logged, and is
 * never returned by any listing or API (ADR-034).
 */

export interface WrappedKey {
  /** Which master key wrapped it, so an older one can still be unwrapped. */
  readonly keyId: string
  /** The wrapped data key, base64. */
  readonly wrapped: string
}

export interface KeyProvider {
  /** The id of the key new secrets are wrapped with. */
  readonly currentKeyId: string
  /**
   * Every key id this provider holds, current and retired — what boot
   * validation checks a stored secret's `keyId` against without opening its
   * ciphertext (ADR-034: "fail closed", not "find out at the moment of use").
   */
  readonly keyIds: readonly string[]
  wrap(dataKey: Uint8Array): Promise<WrappedKey>
  /** Null when this provider does not hold the key that wrapped it. */
  unwrap(key: WrappedKey): Promise<Uint8Array | null>
}

/** A secret as it is stored: ciphertext, and the wrapped key that opens it. */
export interface SealedSecret {
  /** Base64 of the nonce, the tag, and the ciphertext. */
  readonly ciphertext: string
  readonly wrappedKey: WrappedKey
}

/**
 * Envelope encryption over a {@link KeyProvider}. The cipher itself
 * (AES-256-GCM) is infrastructure; this is what the use cases speak.
 */
export interface SecretCipher {
  /** The key id new secrets are wrapped with; a rotation targets it. */
  readonly currentKeyId: string
  /** Every key id this cipher can unwrap — see {@link KeyProvider.keyIds}. */
  readonly keyIds: readonly string[]
  /**
   * `name` is not stored with the ciphertext; it is *authenticated* with it.
   * Opening the row demands the same name, so a row cannot be moved to
   * another name and read as that secret — the attack available to anybody
   * who can write the table without holding the master key.
   */
  seal(name: string, value: string): Promise<SealedSecret>
  /**
   * Null when no available master key opens it, when the ciphertext is not
   * intact, or when it was sealed under a different name.
   */
  open(name: string, sealed: SealedSecret): Promise<string | null>
  /**
   * The same ciphertext with its data key wrapped by the current master key,
   * or null when no available master key unwraps it — the one failure a
   * rotation reports by name, because that secret has to be entered again.
   *
   * The name is not needed: rotation re-wraps the data key and never touches
   * the value, so the label bound to the value is carried across untouched.
   */
  rewrap(sealed: SealedSecret): Promise<SealedSecret | null>
}

export interface SecretRow {
  readonly name: string
  readonly ciphertext: string
  readonly wrappedKey: string
  readonly keyId: string
  readonly createdAt: Date
  /** When the *value* was last replaced by an administrator. */
  readonly rotatedAt: Date | null
  /**
   * When the data key was last re-wrapped by a master-key rotation. Separate
   * from `rotatedAt` because they answer different questions: "has anybody
   * changed this secret since the incident" is not "has this secret moved to
   * the new master key", and one stamp answering both makes a rotation look
   * like an administrator editing every secret at once.
   */
  readonly rewrappedAt: Date | null
}

/** A secret without anything that could reconstruct it. */
export interface SecretSummary {
  readonly name: string
  readonly keyId: string
  readonly createdAt: Date
  readonly rotatedAt: Date | null
  readonly rewrappedAt: Date | null
}

export interface SecretsRepository {
  find(name: string): Promise<SecretRow | null>
  /** Names and key ids only: this is what an API may see. */
  list(): Promise<readonly SecretSummary[]>
  /** Inserts, or replaces the value of an existing secret under the same name. */
  put(input: {
    readonly name: string
    readonly ciphertext: string
    readonly wrappedKey: string
    readonly keyId: string
    readonly now: Date
  }): Promise<SecretRow>
  /**
   * Re-wrap one secret's data key, leaving its ciphertext untouched.
   *
   * A compare-and-swap on the envelope it read: the update lands only while
   * the row still carries `fromKeyId` and `fromWrappedKey`. Without it, a
   * rotation running beside an administrator replacing that very secret would
   * write the old value's data key over the new value's, and the new value
   * would never open again. Answers false when the row moved, which the
   * rotation takes as "read it again".
   */
  rewrap(input: {
    readonly name: string
    readonly fromKeyId: string
    readonly fromWrappedKey: string
    readonly wrappedKey: string
    readonly keyId: string
    readonly now: Date
  }): Promise<boolean>
  delete(name: string): Promise<boolean>
  /**
   * Every secret still wrapped by a key other than `keyId`, oldest first, and
   * after `cursor` when one is given.
   *
   * Paged by `(created_at, name)` rather than by offset, so a rotation walks
   * the table once however many rows it re-wraps and never re-reads a page it
   * has already done.
   */
  listWrappedWithOther(input: {
    readonly keyId: string
    readonly limit: number
    readonly after?: SecretCursor
  }): Promise<readonly SecretRow[]>
}

/** Where a paged walk of the secrets got to: the last row it returned. */
export interface SecretCursor {
  readonly createdAt: Date
  readonly name: string
}
