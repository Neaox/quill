import { randomUUID } from 'node:crypto'
import { randomUUID as uuid } from 'crypto'

export function id(): string {
  return randomUUID()
}

export function otherId(): string {
  return uuid()
}
