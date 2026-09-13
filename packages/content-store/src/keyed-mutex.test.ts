import { describe, expect, it } from 'vitest'

import { KeyedMutex } from './keyed-mutex.ts'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('KeyedMutex', () => {
  it('runs tasks with the same key one at a time', async () => {
    const mutex = new KeyedMutex()
    const order: string[] = []
    const task = (name: string) => async (): Promise<void> => {
      order.push(`${name} start`)
      await tick()
      order.push(`${name} end`)
    }
    await Promise.all([mutex.run('w', task('one')), mutex.run('w', task('two'))])
    expect(order).toEqual(['one start', 'one end', 'two start', 'two end'])
  })

  it('lets different keys run at the same time', async () => {
    const mutex = new KeyedMutex()
    const order: string[] = []
    const task = (name: string) => async (): Promise<void> => {
      order.push(`${name} start`)
      await tick()
      order.push(`${name} end`)
    }
    await Promise.all([mutex.run('a', task('one')), mutex.run('b', task('two'))])
    expect(order).toEqual(['one start', 'two start', 'one end', 'two end'])
  })

  it('returns each task its own result', async () => {
    const mutex = new KeyedMutex()
    const results = await Promise.all([
      mutex.run('w', async () => 1),
      mutex.run('w', async () => 2),
    ])
    expect(results).toEqual([1, 2])
  })

  it('does not let a failed task block the queue behind it', async () => {
    const mutex = new KeyedMutex()
    const failure = mutex.run('w', async () => {
      throw new Error('boom')
    })
    const after = mutex.run('w', async () => 'ran anyway')
    await expect(failure).rejects.toThrow('boom')
    expect(await after).toBe('ran anyway')
  })

  it('forgets a key once its queue has drained', async () => {
    const mutex = new KeyedMutex()
    await mutex.run('w', async () => undefined)
    await tick()
    expect(mutex.pending).toBe(0)
  })
})
