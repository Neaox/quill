import { describe, expect, it } from 'vitest'

import { createMessageAuthenticator } from './message-authenticator.ts'

describe('createMessageAuthenticator', () => {
  it('is HMAC-SHA-256 in lower-case hex, as GitHub signs a delivery', () => {
    // The example from GitHub's "Validating webhook deliveries".
    const signature = createMessageAuthenticator().hmacSha256(
      "It's a Secret to Everybody",
      new TextEncoder().encode('Hello, World!'),
    )
    expect(signature).toBe('757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17')
  })
})
