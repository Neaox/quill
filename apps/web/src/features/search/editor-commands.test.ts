import { describe, expect, it, vi } from 'vitest'

import { currentEditorCommands, registerEditorCommands } from './editor-commands.ts'

const command = (id: string) => ({ id, label: id, keywords: [], run: vi.fn() })

describe('the commands the open editor offers the palette', () => {
  it('are none while no editor is registered', () => {
    expect(currentEditorCommands()).toEqual([])
  })

  it('are what the registered source says now, asked each time', () => {
    let offered = [command('a')]
    const unregister = registerEditorCommands(() => offered)
    expect(currentEditorCommands().map((entry) => entry.id)).toEqual(['a'])
    offered = [command('b'), command('c')]
    expect(currentEditorCommands().map((entry) => entry.id)).toEqual(['b', 'c'])
    unregister()
  })

  it('go away with the editor that registered them', () => {
    const unregister = registerEditorCommands(() => [command('a')])
    unregister()
    expect(currentEditorCommands()).toEqual([])
  })

  it('come from the most recently opened editor first, and survive another closing', () => {
    const first = registerEditorCommands(() => [command('first')])
    const second = registerEditorCommands(() => [command('second')])
    expect(currentEditorCommands().map((entry) => entry.id)).toEqual(['second', 'first'])
    second()
    expect(currentEditorCommands().map((entry) => entry.id)).toEqual(['first'])
    first()
  })

  it('unregister once, however often they are asked to', () => {
    const unregister = registerEditorCommands(() => [command('a')])
    unregister()
    unregister()
    expect(currentEditorCommands()).toEqual([])
  })
})
