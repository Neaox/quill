export function timestamp(): number {
  return globalThis.Date.now()
}

export function id(): string {
  return globalThis.crypto.randomUUID()
}

export function random(): number {
  return globalThis.Math.random()
}

export function freshDate(): Date {
  return new globalThis.Date()
}
