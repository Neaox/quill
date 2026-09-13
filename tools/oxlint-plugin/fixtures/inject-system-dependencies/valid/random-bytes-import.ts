import { randomBytes } from 'node:crypto'

// `randomBytes` is a keying/salting primitive, not a Clock or IdGenerator
// concern, so it is deliberately outside this rule's scope.
export function token(): Buffer {
  return randomBytes(16)
}
