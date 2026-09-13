// Not imported from `node:crypto`, so the name alone must not trip the rule.
function randomUUID(): string {
  return 'fixed'
}

export function id(): string {
  return randomUUID()
}
