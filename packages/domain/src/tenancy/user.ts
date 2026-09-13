import type { UserId } from '../ids.ts'

/** A person with an account on the instance. */
export interface User {
  readonly id: UserId
  readonly name: string
  readonly email: string
}
