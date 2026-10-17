declare function fetchOne(id: string): Promise<number>
declare const tx: {
  insert(row: string): Promise<void>
  items: { find(id: string): Promise<number> }
}

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

export async function accumulate(ids: string[]) {
  let total = 0
  for (const id of ids) {
    total += await fetchOne(id)
  }
  return total
}

export async function count(ids: string[]) {
  let hidden = 0
  for (const id of ids) {
    if ((await fetchOne(id)) === 0) hidden += 1
  }
  return hidden
}

export async function stepped(ids: string[]) {
  for (let from = 0; from < ids.length; from += 10) {
    await fetchOne(ids[from] ?? '')
  }
}

export async function throughHandle(ids: string[]) {
  for (const id of ids) {
    await tx.items.find(id)
  }
}
