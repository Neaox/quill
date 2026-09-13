import { describe, expect, it } from 'vitest'
import type { Lock, LockHolder } from './clients.ts'
import type { LockState } from './lock-machine.ts'
import { initialLockState, lockReducer } from './lock-machine.ts'

const lock: Lock = { holderUserId: 'u1', holderSessionId: 's1', expiresAt: 60_000 }
const holder: LockHolder = { userId: 'u2', displayName: 'Priya', expiresAt: 120_000 }

const held = lockReducer(initialLockState, {
  type: 'acquire-result',
  result: { status: 'acquired', lock },
})

const fail = (state: LockState): LockState => lockReducer(state, { type: 'heartbeat-failed' })

describe('initialLockState', () => {
  it('holds nothing and forbids autosave', () => {
    expect(initialLockState).toEqual({
      status: 'idle',
      lock: null,
      holder: null,
      missedHeartbeats: 0,
      canAutosave: false,
    })
  })
})

describe('acquiring', () => {
  it('reports the attempt without claiming anything', () => {
    const state = lockReducer(initialLockState, { type: 'acquire-started' })
    expect(state).toMatchObject({ status: 'acquiring', lock: null, canAutosave: false })
  })

  it('drops a stale holder when a new attempt starts', () => {
    const other = lockReducer(initialLockState, {
      type: 'acquire-result',
      result: { status: 'held', holder },
    })
    expect(lockReducer(other, { type: 'acquire-started' }).holder).toBeNull()
  })

  it('holds the lock and permits autosave once acquired', () => {
    expect(held).toEqual({
      status: 'held',
      lock,
      holder: null,
      missedHeartbeats: 0,
      canAutosave: true,
    })
  })

  it('names the other holder when the document is already taken', () => {
    const state = lockReducer(initialLockState, {
      type: 'acquire-result',
      result: { status: 'held', holder },
    })
    expect(state).toEqual({
      status: 'held_by_other',
      lock: null,
      holder,
      missedHeartbeats: 0,
      canAutosave: false,
    })
  })
})

describe('heartbeat outcomes', () => {
  it('extends the lock and clears the miss count when one succeeds', () => {
    const shaky = fail(fail(held))
    const state = lockReducer(shaky, {
      type: 'heartbeat-result',
      result: { status: 'alive', expiresAt: 90_000 },
    })

    expect(state.status).toBe('held')
    expect(state.lock).toEqual({ ...lock, expiresAt: 90_000 })
    expect(state.missedHeartbeats).toBe(0)
    expect(state.canAutosave).toBe(true)
  })

  it('reports the lock lost when our own lease has lapsed', () => {
    const state = lockReducer(held, { type: 'heartbeat-result', result: { status: 'expired' } })
    expect(state).toEqual({ ...initialLockState, status: 'lost' })
  })

  it('names the new holder after a takeover', () => {
    const state = lockReducer(held, {
      type: 'heartbeat-result',
      result: { status: 'taken_over', holder },
    })
    expect(state).toMatchObject({ status: 'held_by_other', lock: null, holder, canAutosave: false })
  })

  it('accepts that the lock is simply gone', () => {
    const state = lockReducer(held, { type: 'heartbeat-result', result: { status: 'released' } })
    expect(state).toEqual({ ...initialLockState, status: 'released' })
  })

  it('ignores a reply that arrives after the lock has already gone', () => {
    const lost = lockReducer(held, { type: 'heartbeat-result', result: { status: 'expired' } })
    const late = lockReducer(lost, {
      type: 'heartbeat-result',
      result: { status: 'alive', expiresAt: 90_000 },
    })
    expect(late).toBe(lost)
  })
})

describe('missed heartbeats (R5 section 4)', () => {
  it('treats one failure to complete as reconnecting, not as fine', () => {
    const state = fail(held)
    expect(state).toEqual({
      status: 'reconnecting',
      lock,
      holder: null,
      missedHeartbeats: 1,
      canAutosave: false,
    })
  })

  it('escalates to at risk from the second miss onwards', () => {
    expect(fail(fail(held)).status).toBe('at_risk')
    expect(fail(fail(fail(held)))).toMatchObject({ status: 'at_risk', missedHeartbeats: 3 })
  })

  it('keeps the lock in state, because nobody else can take it until it expires', () => {
    expect(fail(held).lock).toBe(lock)
  })

  it('ignores a transport failure once the lock has already gone', () => {
    const released = lockReducer(held, { type: 'released' })
    expect(fail(released)).toBe(released)
  })
})

describe('takeover', () => {
  it('holds the lock after an admin takes an active one', () => {
    const other = lockReducer(initialLockState, {
      type: 'acquire-result',
      result: { status: 'held', holder },
    })
    const state = lockReducer(other, {
      type: 'takeover-result',
      result: { status: 'acquired', lock },
    })
    expect(state).toEqual(held)
  })

  it('changes nothing when takeover is refused', () => {
    const other = lockReducer(initialLockState, {
      type: 'acquire-result',
      result: { status: 'held', holder },
    })
    expect(lockReducer(other, { type: 'takeover-result', result: { status: 'forbidden' } })).toBe(
      other,
    )
  })
})

describe('release', () => {
  it('gives up the lock', () => {
    expect(lockReducer(held, { type: 'released' })).toEqual({
      ...initialLockState,
      status: 'released',
    })
  })
})

describe('autosave confidence', () => {
  it('is granted in held and nowhere else', () => {
    const other = lockReducer(initialLockState, {
      type: 'acquire-result',
      result: { status: 'held', holder },
    })
    const states: readonly LockState[] = [
      initialLockState,
      lockReducer(initialLockState, { type: 'acquire-started' }),
      held,
      fail(held),
      fail(fail(held)),
      lockReducer(held, { type: 'heartbeat-result', result: { status: 'expired' } }),
      other,
      lockReducer(held, { type: 'released' }),
    ]

    expect(states.map((state) => state.status)).toEqual([
      'idle',
      'acquiring',
      'held',
      'reconnecting',
      'at_risk',
      'lost',
      'held_by_other',
      'released',
    ])
    expect(states.filter((state) => state.canAutosave)).toEqual([held])
  })

  it('is never regained by the mere passage of time', () => {
    const lost = lockReducer(held, { type: 'heartbeat-result', result: { status: 'expired' } })
    const stillLost = fail(lockReducer(lost, { type: 'heartbeat-failed' }))
    expect(stillLost.canAutosave).toBe(false)

    const regained = lockReducer(lost, {
      type: 'acquire-result',
      result: { status: 'acquired', lock },
    })
    expect(regained.canAutosave).toBe(true)
  })
})
