import { afterEach, describe, expect, it, vi } from 'vitest'

describe('prism-runtime-guard', () => {
  afterEach(() => {
    delete (globalThis as { Prism?: unknown }).Prism
    vi.resetModules()
  })

  it('flags manual mode and disables the worker message handler on the global Prism seed', async () => {
    await import('./prism-runtime-guard.ts')
    const scope = globalThis as {
      Prism?: { manual?: boolean; disableWorkerMessageHandler?: boolean }
    }
    expect(scope.Prism?.manual).toBe(true)
    expect(scope.Prism?.disableWorkerMessageHandler).toBe(true)
  })

  it('preserves fields already on the global Prism seed', async () => {
    ;(globalThis as { Prism?: Record<string, unknown> }).Prism = { existing: 'value' }
    await import('./prism-runtime-guard.ts')
    const scope = globalThis as { Prism?: Record<string, unknown> }
    expect(scope.Prism?.['existing']).toBe('value')
    expect(scope.Prism?.['manual']).toBe(true)
  })
})
