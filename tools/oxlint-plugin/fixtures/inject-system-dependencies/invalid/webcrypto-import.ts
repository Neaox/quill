import { webcrypto } from 'node:crypto'

export function id(): string {
  return webcrypto.randomUUID()
}
