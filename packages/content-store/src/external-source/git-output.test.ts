import { describe, expect, it } from 'vitest'

import { batchObjects, nulFields } from './git-output.ts'
import type { BatchObject } from './git-output.ts'

/** The same bytes, cut into chunks of `size`, as a pipe might deliver them. */
async function* chunked(bytes: Buffer, size: number): AsyncGenerator<Buffer> {
  for (let start = 0; start < bytes.length; start += size) yield bytes.subarray(start, start + size)
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

describe('nulFields', () => {
  it.each([1, 2, 7, 1000])(
    'splits on NUL however the bytes arrive (chunks of %i)',
    async (size) => {
      const bytes = Buffer.from('größe\0b\0\0ドキュメント\0', 'utf8')

      await expect(collect(nulFields(chunked(bytes, size)))).resolves.toEqual([
        'größe',
        'b',
        '',
        'ドキュメント',
      ])
    },
  )
})

describe('batchObjects', () => {
  const ID_A = 'a'.repeat(40)
  const ID_B = 'b'.repeat(40)
  const ID_C = 'c'.repeat(40)
  const output = Buffer.concat([
    Buffer.from(`${ID_A} blob 6\nhello\n\n`),
    Buffer.from(`${ID_B} missing\n`),
    Buffer.from(`${ID_C} blob 12\nlonger text!\n`),
    Buffer.from(`${ID_A} tree 0\n\n`),
  ])

  it.each([1, 3, 16, 4096])(
    'reads objects however the bytes arrive (chunks of %i)',
    async (size) => {
      const objects = await collect(batchObjects(chunked(output, size), 10))

      expect(objects).toEqual<BatchObject[]>([
        { kind: 'object', id: ID_A, type: 'blob', bytes: Buffer.from('hello\n') },
        { kind: 'missing', id: ID_B },
        { kind: 'too-large', id: ID_C, type: 'blob', size: 12 },
        { kind: 'object', id: ID_A, type: 'tree', bytes: Buffer.alloc(0) },
      ])
    },
  )
})
