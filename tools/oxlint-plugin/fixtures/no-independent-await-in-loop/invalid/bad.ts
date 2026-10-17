declare function fetchOne(id: string): Promise<number>

export async function loadAll(ids: string[]) {
  const results: number[] = []
  for (const id of ids) {
    results.push(await fetchOne(id))
  }
  return results
}

export async function loadByIndex(ids: string[]) {
  for (let i = 0; i < ids.length; i++) {
    await fetchOne(ids[i] ?? '')
  }
}
