import { createFakeContentStore } from '@quill/application/test-support'
import { workspaceId } from '@quill/domain'
import { describe, expect, it } from 'vitest'

import { inertSourceSync } from './inert-source-sync.ts'

const HANDBOOK = workspaceId('00000000-0000-4000-8000-000000000101')

describe('inertSourceSync', () => {
  it('opens no source and runs the work it is handed', async () => {
    const store = createFakeContentStore()
    const ports = inertSourceSync(store)
    expect(ports.contentStore).toBe(store)
    expect(await ports.sources.forWorkspace(HANDBOOK)).toBeNull()
    expect(await ports.lock.withLock(HANDBOOK, async () => 7)).toEqual({ kind: 'ran', value: 7 })
    expect(ports.allowFileRemotesForTesting).toBe(false)
  })
})
