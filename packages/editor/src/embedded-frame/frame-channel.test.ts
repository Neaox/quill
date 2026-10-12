import { Type } from '@sinclair/typebox'
import { describe, expect, it, vi } from 'vitest'

import { createFrameChannel, jsonStringCodec } from './frame-channel.ts'
import type { FrameRejection } from './frame-channel.ts'

const ORIGIN = 'https://draw.example.com'

const Inbound = Type.Union([
  Type.Object({ event: Type.Literal('init') }),
  Type.Object({ event: Type.Literal('save'), xml: Type.String() }),
])

type Outbound = { readonly action: 'load'; readonly xml: string }

function setup() {
  const frame = { postMessage: vi.fn() }
  const received: unknown[] = []
  const rejected: FrameRejection[] = []
  const channel = createFrameChannel({
    host: window,
    target: () => frame,
    origin: ORIGIN,
    inbound: Inbound,
    codec: jsonStringCodec<Outbound>(),
    onMessage: (message) => received.push(message),
    onReject: (reason) => rejected.push(reason),
  })
  const post = (data: unknown, origin = ORIGIN, source: unknown = frame) => {
    window.dispatchEvent(
      new MessageEvent('message', { data, origin, source: source as MessageEventSource }),
    )
  }
  return { frame, channel, received, rejected, post }
}

describe('createFrameChannel', () => {
  it('accepts a well-formed message from the frame, on its origin', () => {
    const { received, rejected, post, channel } = setup()
    post('{"event":"save","xml":"<mxfile/>"}')
    expect(received).toEqual([{ event: 'save', xml: '<mxfile/>' }])
    expect(rejected).toEqual([])
    channel.dispose()
  })

  it('drops a message from any other origin, however well formed', () => {
    const { received, rejected, post, channel } = setup()
    post('{"event":"init"}', 'https://evil.example')
    post('{"event":"init"}', 'https://draw.example.com.evil.example')
    post('{"event":"init"}', 'null')
    expect(received).toEqual([])
    expect(rejected).toEqual(['origin', 'origin', 'origin'])
    channel.dispose()
  })

  it('drops a message from another window on the same origin', () => {
    const { received, rejected, post, channel } = setup()
    post('{"event":"init"}', ORIGIN, window)
    post('{"event":"init"}', ORIGIN, null)
    expect(received).toEqual([])
    expect(rejected).toEqual(['source', 'source'])
    channel.dispose()
  })

  it('drops a message that does not decode, or is not one the protocol has', () => {
    const { received, rejected, post, channel } = setup()
    post('not json')
    post({ event: 'init' })
    post('{"event":"save"}')
    post('{"event":"save","xml":42}')
    post('{"event":"export","data":"<script>"}')
    post('null')
    expect(received).toEqual([])
    expect(rejected).toEqual(['undecodable', 'undecodable', 'shape', 'shape', 'shape', 'shape'])
    channel.dispose()
  })

  it('sends to the frame’s origin alone, never to any', () => {
    const { frame, channel } = setup()
    expect(channel.send({ action: 'load', xml: '<mxfile/>' })).toBe(true)
    expect(frame.postMessage).toHaveBeenCalledWith('{"action":"load","xml":"<mxfile/>"}', ORIGIN)
    channel.dispose()
  })

  it('stops listening and sending once disposed, and sends nothing to a frame not yet there', () => {
    const { frame, channel, received, post } = setup()
    channel.dispose()
    post('{"event":"init"}')
    expect(received).toEqual([])
    expect(channel.send({ action: 'load', xml: '' })).toBe(false)
    expect(frame.postMessage).not.toHaveBeenCalled()

    const absent = createFrameChannel({
      host: window,
      target: () => null,
      origin: ORIGIN,
      inbound: Inbound,
      codec: jsonStringCodec<Outbound>(),
      onMessage: () => {},
    })
    expect(absent.send({ action: 'load', xml: '' })).toBe(false)
    window.dispatchEvent(new MessageEvent('message', { data: '{"event":"init"}', origin: ORIGIN }))
    absent.dispose()
  })
})
