// camelCase names ending in a pattern word are legitimate English (a TCP
// port number), not the hexagonal "port" pattern — only PascalCase and
// type-level names are banned.
export function parsePort(raw: string): number {
  return Number.parseInt(raw, 10)
}

export const serverPort = 3000
export let listenPort = 8080
