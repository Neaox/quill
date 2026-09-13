import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import {
  errorCode,
  fileAge,
  isLockContention,
  isRenameContention,
  renameWithRetry,
  retryOnContention,
} from './contention.ts'

const root = await mkdtemp(join(tmpdir(), 'content-store-contention-'))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('errorCode', () => {
  it('reads the code off a system error', () => {
    expect(errorCode(errno('EPERM'))).toBe('EPERM')
  })

  it('has nothing to report for a value that is not an error', () => {
    expect(errorCode('EPERM')).toBeUndefined()
  })
})

describe('isRenameContention', () => {
  it.each(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])('treats %s as another holder', (code) => {
    expect(isRenameContention(errno(code))).toBe(true)
  })

  it('does not treat a missing file as contention', () => {
    expect(isRenameContention(errno('ENOENT'))).toBe(false)
  })

  it('has nothing to retry for a value that is not an error', () => {
    expect(isRenameContention('EPERM')).toBe(false)
  })
})

describe('isLockContention', () => {
  const missing = join(root, 'nothing.lock')

  it('treats an exclusive-create collision as another holder', () => {
    expect(isLockContention(errno('EEXIST'), missing)).toBe(true)
  })

  it.each(['EPERM', 'EBUSY'])(
    'treats %s on a lock that is there as another holder',
    async (code) => {
      const held = join(root, `held-${code}.lock`)
      await writeFile(held, '')
      expect(isLockContention(errno(code), held)).toBe(true)
    },
  )

  it.each(['EPERM', 'EBUSY'])('reports %s with no lock in the way as itself', (code) => {
    expect(isLockContention(errno(code), missing)).toBe(false)
  })

  it.each(['EACCES', 'ENOSPC', 'ENOENT'])('never hides %s behind contention', async (code) => {
    const held = join(root, `denied-${code}.lock`)
    await writeFile(held, '')
    expect(isLockContention(errno(code), held)).toBe(false)
  })

  it('has nothing to blame for a value that is not an error', () => {
    expect(isLockContention('EEXIST', missing)).toBe(false)
  })
})

describe('fileAge', () => {
  it('measures a file against the clock it was given', async () => {
    const path = join(root, 'aged.lock')
    await writeFile(path, '')
    const later = new Date((await stat(path)).mtimeMs + 90_000)
    expect(await fileAge(path, later)).toBeCloseTo(90_000, -1)
  })

  it('has no age for a file that is no longer there', async () => {
    expect(await fileAge(join(root, 'vanished.lock'), new Date())).toBeNull()
  })

  it('reports a failure that is not a missing file', async () => {
    await expect(fileAge('lock\u0000name', new Date())).rejects.toThrow(/null bytes/)
  })
})

describe('retryOnContention', () => {
  it('returns the first time an operation succeeds', async () => {
    let calls = 0
    const value = await retryOnContention(async () => {
      calls += 1
      return 'done'
    })
    expect([value, calls]).toEqual(['done', 1])
  })

  it('retries while Windows reports the destination is held', async () => {
    const slept: number[] = []
    let calls = 0
    const value = await retryOnContention(
      async () => {
        calls += 1
        if (calls < 3) throw errno('EPERM')
        return calls
      },
      { sleep: async (ms) => void slept.push(ms) },
    )
    expect(value).toBe(3)
    expect(slept).toEqual([1, 2])
  })

  it('gives up after the attempt limit and rethrows', async () => {
    await expect(
      retryOnContention(
        async () => {
          throw errno('EBUSY')
        },
        { attempts: 2, sleep: async () => undefined },
      ),
    ).rejects.toThrow('EBUSY')
  })

  it('does not retry an error that will never clear', async () => {
    let calls = 0
    await expect(
      retryOnContention(async () => {
        calls += 1
        throw errno('ENOENT')
      }),
    ).rejects.toThrow('ENOENT')
    expect(calls).toBe(1)
  })

  it('backs off no further than ten milliseconds', async () => {
    const slept: number[] = []
    await expect(
      retryOnContention(
        async () => {
          throw errno('EEXIST')
        },
        { attempts: 13, sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toThrow('EEXIST')
    expect(Math.max(...slept)).toBe(10)
  })
})

describe('renameWithRetry', () => {
  it('renames a file that nothing is holding', async () => {
    const from = join(root, 'from.txt')
    const to = join(root, 'to.txt')
    await writeFile(from, 'content')
    await renameWithRetry(from, to)
    expect(await readFile(to, 'utf8')).toBe('content')
  })

  it('replaces a destination that is already there', async () => {
    const from = join(root, 'replacement.txt')
    const to = join(root, 'replaced.txt')
    await writeFile(to, 'stale')
    await writeFile(from, 'fresh')
    await renameWithRetry(from, to)
    expect(await readFile(to, 'utf8')).toBe('fresh')
  })

  it('passes its options through to the retry loop', async () => {
    await expect(
      renameWithRetry(join(root, 'nothing'), join(root, 'somewhere'), { attempts: 1 }),
    ).rejects.toThrow(/ENOENT/)
  })
})
