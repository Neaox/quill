declare function fetchPage(cursor: string | undefined): Promise<{ next?: string }>
declare function fetchOne(id: string): Promise<number>
declare function sleep(ms: number): Promise<void>
declare function ready(): Promise<boolean>
declare const tx: { insert(row: string): Promise<void> }
declare const chunks: string[][]
declare const source: AsyncIterable<number>

export async function paginate(first: string | undefined) {
  let cursor = first
  for (let page = 0; page < 10; page++) {
    const result = await fetchPage(cursor)
    cursor = result.next
  }
}

export async function retry() {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await ready()) return true
    await sleep(attempt * 100)
  }
  return false
}

export async function budgeted(ids: string[]) {
  let budget = 100
  for (const id of ids) {
    budget -= await fetchOne(id.slice(0, budget))
  }
  return budget
}

export async function countedAttempts(ids: string[]) {
  let failures = 0
  for (const id of ids) {
    if ((await fetchOne(id)) === 0) failures += 1
    if (failures > 3) await sleep(failures * 100)
  }
}

export async function chunkedByIndex(ids: string[]) {
  for (let from = 0; from < ids.length; from += 10) {
    await Promise.all(ids.slice(from, from + 10).map((id) => fetchOne(id)))
  }
}

export async function dedupe(ids: string[]) {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    await fetchOne(id)
    seen.add(id)
  }
}

export async function transactional(rows: string[]) {
  for (const row of rows) {
    await tx.insert(row)
  }
}

export async function chunked() {
  for (const chunk of chunks) {
    await Promise.all(chunk.map((id) => fetchOne(id)))
  }
}

export async function untilFound(ids: string[]) {
  for (const id of ids) {
    if ((await fetchOne(id)) > 0) break
  }
}

export async function streaming() {
  for await (const value of source) {
    await fetchOne(String(value))
  }
}

export async function polling() {
  while (!(await ready())) {
    await fetchOne('x')
  }
}
