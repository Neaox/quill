import { createHmac } from 'node:crypto'

import type { MessageAuthenticator } from '@quill/application'

/**
 * The `MessageAuthenticator` port on HMAC-SHA-256 (ADR-061): what a forge
 * signs a push webhook's raw body with, under the source's shared secret.
 */
export function createMessageAuthenticator(): MessageAuthenticator {
  return {
    hmacSha256(key: string, message: Uint8Array): string {
      return createHmac('sha256', key).update(message).digest('hex')
    },
  }
}
