import { SHORT_ID_BYTES, shortIdFrom } from '@quill/domain'
import type { IdGenerator } from '@quill/application'

/**
 * The real id generator, used only at the composition root (`main.ts`);
 * everything else takes an `IdGenerator`.
 *
 * Both ids are drawn from the platform's cryptographic random source: a
 * document's short key is public and guessing one would be guessing a
 * document, so it is drawn the same way a token is, never from `Math.random`
 * (ADR-035).
 */
export function createUuidGenerator(): IdGenerator {
  return {
    uuid: () => crypto.randomUUID(),
    shortId: () => shortIdFrom(crypto.getRandomValues(new Uint8Array(SHORT_ID_BYTES))),
  }
}
