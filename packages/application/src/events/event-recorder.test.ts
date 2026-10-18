import { describe, expect, it, vi } from 'vitest'

import type { OutboxWriter } from '../ports/persistence.ts'
import { defineEvent } from './define-event.ts'
import type { RecordedEvent } from '../ports/events.ts'
import { createEventRecorder } from './event-recorder.ts'

interface Greeted {
  readonly version: number
  readonly name: string
}
const greeted = defineEvent<Greeted>('Greeted', {
  1: (payload) => ({ version: 1, name: String((payload as { name?: unknown }).name) }),
})

const NOW = new Date('2026-10-13T00:00:00.000Z')

function aRecorder(write: OutboxWriter['write'] = async () => {}) {
  const sink = vi.fn<(event: RecordedEvent) => void>()
  const outbox: OutboxWriter = { write: vi.fn<OutboxWriter['write']>(write) }
  const recorder = createEventRecorder({
    outbox,
    ids: { uuid: () => 'event-1' },
    sink,
  })
  return { recorder, sink, outbox }
}

describe('createEventRecorder', () => {
  it('writes the outbox row with the event’s type and the version this release writes', async () => {
    const { recorder, outbox } = aRecorder()
    await recorder.record(greeted, { name: 'Ada' }, NOW)
    expect(outbox.write).toHaveBeenCalledWith({
      id: 'event-1',
      type: 'Greeted',
      payload: { version: 1, name: 'Ada' },
      now: NOW,
    })
  })

  it('hands what it recorded to the unit of work for publication, after the row is written', async () => {
    const order: string[] = []
    const { recorder, sink } = aRecorder(async () => {
      order.push('written')
    })
    sink.mockImplementation(() => order.push('sunk'))
    await recorder.record(greeted, { name: 'Ada' }, NOW)
    expect(order).toEqual(['written', 'sunk'])
    expect(sink).toHaveBeenCalledWith({ type: 'Greeted', payload: { version: 1, name: 'Ada' } })
  })

  it('does not announce an event that carries a credential, which belongs to the outbox alone', async () => {
    const secret = defineEvent<Greeted>(
      'Secret',
      { 1: (payload) => ({ version: 1, name: String((payload as { name?: unknown }).name) }) },
      { announced: false },
    )
    const { recorder, sink, outbox } = aRecorder()
    await recorder.record(secret, { name: 'token' }, NOW)
    expect(outbox.write).toHaveBeenCalledTimes(1)
    expect(sink).not.toHaveBeenCalled()
  })

  it('publishes nothing for an event whose row was not written', async () => {
    const { recorder, sink } = aRecorder(async () => {
      throw new Error('database down')
    })
    await expect(recorder.record(greeted, { name: 'Ada' }, NOW)).rejects.toThrow('database down')
    expect(sink).not.toHaveBeenCalled()
  })
})
