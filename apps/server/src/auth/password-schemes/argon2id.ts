import { hash, verify } from '@node-rs/argon2'

import type { PasswordScheme } from '../password-scheme.ts'

/**
 * Argon2id, the scheme in force (ADR-011, NIST 800-63B).
 *
 * The parameters are stated here rather than inherited from the library, so
 * a dependency bump can never silently drop the instance below the OWASP
 * minimum — `password.test.ts` decodes the PHC string and asserts them. They
 * are also what `isWeaker` compares a stored hash against, so raising them
 * migrates every account on its owner's next sign-in.
 */
export const ARGON2_PARAMETERS = {
  /** KiB. OWASP's Argon2id minimum is 19 MiB with t=2, p=1. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * `Algorithm.Argon2id`, inlined: `@node-rs/argon2` declares it as an ambient
 * `const enum`, which erasable TypeScript (AGENTS.md rule 5) cannot import.
 */
const ARGON2ID = 2

/** The PHC identifier every hash this scheme writes begins with. */
export const ARGON2ID_SCHEME_ID = '$argon2id$'

/** The `m`, `t` and `p` a PHC string encodes, or null when it is not an Argon2id hash. */
export interface EncodedArgon2Parameters {
  readonly memoryCost: number
  readonly timeCost: number
  readonly parallelism: number
}

const PHC_ARGON2ID = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/

export function readArgon2Parameters(passwordHash: string): EncodedArgon2Parameters | null {
  const match = PHC_ARGON2ID.exec(passwordHash)
  if (match === null) return null
  // Every captured group is `\d+`, so `Number` cannot produce NaN here.
  return {
    memoryCost: Number(match[1]),
    timeCost: Number(match[2]),
    parallelism: Number(match[3]),
  }
}

export const argon2idScheme: PasswordScheme = {
  id: ARGON2ID_SCHEME_ID,

  async hash(plainText: string): Promise<string> {
    return hash(plainText, { ...ARGON2_PARAMETERS, algorithm: ARGON2ID })
  },

  async verify(passwordHash: string, plainText: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plainText)
    } catch {
      // A stored hash this build cannot parse is a failed verification, not a
      // 500: the caller must not be able to tell the two apart anyway.
      return false
    }
  },

  /**
   * True when a hash was made with weaker parameters than the ones in force,
   * or with an Argon2id variant whose parameters this build cannot read.
   */
  isWeaker(passwordHash: string): boolean {
    const encoded = readArgon2Parameters(passwordHash)
    if (encoded === null) return true
    return (
      encoded.memoryCost < ARGON2_PARAMETERS.memoryCost ||
      encoded.timeCost < ARGON2_PARAMETERS.timeCost ||
      encoded.parallelism < ARGON2_PARAMETERS.parallelism
    )
  },
}
