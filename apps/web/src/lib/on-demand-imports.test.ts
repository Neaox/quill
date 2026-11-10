import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { importOnDemand, settleImportsOnDemand } from './on-demand-imports.ts'

const SOURCE = join(import.meta.dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.tsx?$/u.test(entry.name) || /\.(test|gen)\./u.test(entry.name)) return []
    return [path]
  })
}

/** Where a dynamic import that `importOnDemand` was not handed sits in a file: `path:line`. */
function bareImports(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return [...text.matchAll(/\bimport\(/gu)].flatMap(({ index }) => {
    // A comment that names `import()` imports nothing.
    const line = text.slice(text.lastIndexOf('\n', index) + 1, index)
    if (/^\s*(?:\*|\/\/)/u.test(line)) return []
    return /importOnDemand\(\s*\(\)\s*=>\s*$/u.test(text.slice(Math.max(0, index - 60), index))
      ? []
      : [`${relative(SOURCE, path)}:${text.slice(0, index).split(/\r?\n/u).length}`]
  })
}

describe('importOnDemand', () => {
  it('passes the import through and settles once it has', async () => {
    const module = Promise.withResolvers<string>()
    const loading = importOnDemand(() => module.promise)
    let settled = false
    const waiting = settleImportsOnDemand().then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    module.resolve('module')
    await waiting
    expect(settled).toBe(true)
    await expect(loading).resolves.toBe('module')
  })

  it('waits for an import a settled one started, and never rejects for one that failed', async () => {
    const order: string[] = []
    void importOnDemand(async () => {
      order.push('first')
      void importOnDemand(async () => {
        await Promise.resolve()
        order.push('second')
      })
    })
    const failing = importOnDemand(() => Promise.reject(new Error('no chunk')))
    await expect(failing).rejects.toThrow('no chunk')
    await settleImportsOnDemand()
    expect(order).toEqual(['first', 'second'])
  })

  it('is how the app imports every module on demand', () => {
    expect(sourceFiles(SOURCE).flatMap(bareImports)).toEqual([])
  })
})
