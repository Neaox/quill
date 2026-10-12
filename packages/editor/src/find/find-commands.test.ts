import { history, undo } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import type { Command, EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'

import { documentToMdast } from '../document/ast.ts'
import { createEditorTestHarness } from '../testing/harness.ts'
import {
  closeFind,
  editFind,
  findNext,
  findPrevious,
  openFind,
  replaceAll,
  replaceCurrent,
} from './find-commands.ts'
import type { FindPatch } from './find-commands.ts'
import { findDecorations, findKey, findPlugin } from './find-plugin.ts'
import type { FindState } from './find-state.ts'

const harness = createEditorTestHarness()
const NL = String.fromCharCode(10)
const lines = (...rows: string[]) => rows.join(NL) + NL

/** A state over `source`, with the find plugin and history, the caret `at` characters in. */
function open(source: string, at = 0): EditorState {
  const state = harness.state(source).reconfigure({ plugins: [findPlugin(), history()] })
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))))
}

/** Runs a command and returns the state it makes, or throws if it declined. */
function run(state: EditorState, command: Command): EditorState {
  let next: EditorState | undefined
  const ran = command(state, (tr) => {
    next = state.apply(tr)
  })
  if (!ran) throw new Error('The command declined.')
  return next ?? state
}

const find = (state: EditorState): FindState => {
  const found = findKey.getState(state)
  if (found === undefined) throw new Error('No find plugin.')
  return found
}

/** Opens find and searches for something, as someone typing in the bar does. */
function searching(source: string, patch: FindPatch | string, at = 0): EditorState {
  const opened = run(open(source, at), openFind(false))
  return run(opened, editFind(typeof patch === 'string' ? { query: patch } : patch))
}

const markdown = (state: EditorState) => harness.read(documentToMdast(state.doc).tree)
const selected = (state: EditorState) =>
  state.doc.textBetween(state.selection.from, state.selection.to)
const select = (state: EditorState, from: number, to = from) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
const drawn = (state: EditorState, kind: 'match' | 'current' | 'scope' | 'selection') =>
  findDecorations(state).find(undefined, undefined, (spec) => spec['find'] === kind)

const DOC = lines('The plan is a plan.', '', 'Plan again, then PLAN.')

describe('opening and closing find', () => {
  it('starts closed, with nothing found', () => {
    expect(find(open(DOC))).toMatchObject({ open: false, query: '' })
    expect(find(open(DOC)).found.matches).toEqual([])
  })

  it('opens with what is selected, if it is on one line, as the thing to find', () => {
    const picked = select(open(DOC), 5, 9)

    expect(find(run(picked, openFind(false)))).toMatchObject({
      open: true,
      replacing: false,
      query: 'plan',
    })
    expect(find(run(picked, openFind(true))).replacing).toBe(true)
  })

  it('keeps the last query when nothing is selected, and shows the replace row only when asked', () => {
    const closed = run(searching(DOC, 'plan'), closeFind)
    const again = run(closed, openFind(true))

    expect(find(closed).open).toBe(false)
    expect(find(again)).toMatchObject({ open: true, replacing: true, query: 'plan' })
  })

  it('counts each time it is asked for, so a bar already open can take focus again', () => {
    const once = run(open(DOC), openFind(false))

    expect(find(once).asked).toBe(1)
    expect(find(run(once, openFind(true))).asked).toBe(2)
  })

  it('does not take a selection that runs across blocks as the query', () => {
    const across = select(open(DOC), 3, 25)

    expect(find(run(across, openFind(false))).query).toBe('')
  })

  it('finds nothing while closed, whatever the query was, and again once opened', () => {
    const closed = run(searching(DOC, 'plan'), closeFind)

    expect(find(closed).found.matches).toEqual([])
    expect(find(run(closed, openFind(false))).found.matches).toHaveLength(4)
  })
})

describe('what is found', () => {
  it('finds each place, and counts them', () => {
    const state = searching(DOC, 'plan')

    expect(find(state).found.matches).toHaveLength(4)
    expect(find(state).pattern.kind).toBe('ok')
  })

  it('narrows by the options, as VS Code’s toggles do', () => {
    const count = (patch: FindPatch) => find(searching(DOC, patch)).found.matches.length

    expect(count({ query: 'plan', options: { caseSensitive: true } })).toBe(2)
    expect(count({ query: 'plan', options: { wholeWord: true } })).toBe(4)
    expect(count({ query: String.raw`pl\w+`, options: { regex: true } })).toBe(4)
    expect(count({ query: 'pla', options: { wholeWord: true } })).toBe(0)
  })

  it('says a regular expression is invalid, with nothing found, instead of failing', () => {
    const state = searching(DOC, { query: '(plan', options: { regex: true } })

    expect(find(state).pattern.kind).toBe('invalid')
    expect(find(state).found.matches).toEqual([])
  })

  it('is found again as the document is edited', () => {
    const state = searching(DOC, 'plan')
    const edited = state.apply(state.tr.insertText(' plan', 4))

    expect(find(edited).found.matches).toHaveLength(5)
  })

  it('draws every match, and the one the selection is on as the current one', () => {
    const state = run(searching(DOC, 'plan'), findNext)

    expect(drawn(state, 'match')).toHaveLength(4)
    expect(drawn(state, 'current')).toHaveLength(1)
    expect(drawn(select(state, 1), 'current')).toHaveLength(0)
  })

  it('draws the stretch it searches when searching in a selection, which is no longer drawn as a selection', () => {
    const picked = select(open(lines('plan one plan', '', 'plan two plan')), 1, 14)
    const state = run(
      run(picked, openFind(false)),
      editFind({ query: 'plan', options: { inSelection: true } }),
    )

    expect(drawn(state, 'scope')).toHaveLength(1)
    expect(drawn(state, 'match')).toHaveLength(2)
    expect(drawn(run(state, editFind({ options: { inSelection: false } })), 'scope')).toHaveLength(
      0,
    )
  })

  it('draws the stretch even where nothing in it is found', () => {
    const picked = select(open(lines('plan one plan', '', 'other words')), 15, 26)
    const state = run(
      run(picked, openFind(false)),
      editFind({ query: 'plan', options: { inSelection: true } }),
    )

    expect(drawn(state, 'scope')).toHaveLength(1)
    expect(drawn(state, 'match')).toHaveLength(0)
  })

  it('keeps the selection drawn while find is open, which a browser stops painting once the bar has the keyboard', () => {
    const state = run(select(open(DOC), 5, 9), openFind(false))

    expect(drawn(state, 'selection')).toHaveLength(1)
    expect(drawn(select(state, 5), 'selection')).toHaveLength(0)
    expect(drawn(run(state, closeFind), 'selection')).toHaveLength(0)
  })

  it('draws nothing while closed', () => {
    expect(findDecorations(run(searching(DOC, 'plan'), closeFind)).find()).toEqual([])
  })
})

describe('stepping through the matches', () => {
  it('selects the next match after the caret, then the next, and round to the first', () => {
    let state = searching(DOC, 'plan', 0)
    const positions: number[] = []
    for (let step = 0; step < 5; step += 1) {
      state = run(state, findNext)
      positions.push(state.selection.from)
      expect(selected(state).toLowerCase()).toBe('plan')
    }

    expect(positions[0]).toBeLessThan(positions[1] ?? 0)
    expect(positions[4]).toBe(positions[0])
    expect(new Set(positions).size).toBe(4)
  })

  it('goes back a match at a time, and round from the first to the last', () => {
    let state = run(searching(DOC, 'plan', 0), findPrevious)
    const last = state.selection.from

    expect(selected(state)).toBe('PLAN')
    state = run(state, findPrevious)
    expect(state.selection.from).toBeLessThan(last)
  })

  it('takes the match the caret is just before as the next, and the one after it once that is selected', () => {
    const first = run(searching(DOC, 'plan', 5), findNext)

    expect(first.selection.from).toBe(5)
    expect(run(first, findNext).selection.from).toBeGreaterThan(5)
  })

  it('declines when there is nothing to step to', () => {
    const state = searching(DOC, 'zzz')

    expect(findNext(state)).toBe(false)
    expect(findPrevious(state)).toBe(false)
    expect(findNext(open(DOC))).toBe(false)
  })

  it('says which match is current: the one that is selected, if one is', () => {
    const state = run(searching(DOC, 'plan'), findNext)

    expect(find(state).current).toBe(0)
    expect(find(run(state, findNext)).current).toBe(1)
    expect(find(select(state, 1)).current).toBe(-1)
  })
})

const scheme = (extra: Partial<FindPatch> = {}): FindPatch => ({
  query: 'plan',
  replacement: 'scheme',
  ...extra,
})

describe('replacing', () => {
  it('selects the next match first when none is selected, then replaces it', () => {
    let state = searching(DOC, scheme())

    state = run(state, replaceCurrent)
    expect(markdown(state)).toBe(DOC)
    expect(selected(state).toLowerCase()).toBe('plan')

    state = run(state, replaceCurrent)
    expect(markdown(state)).toBe(lines('The scheme is a plan.', '', 'Plan again, then PLAN.'))
  })

  it('goes on to the next match after each replacement', () => {
    let state = run(searching(DOC, scheme()), findNext)

    state = run(run(state, replaceCurrent), replaceCurrent)

    expect(markdown(state)).toBe(lines('The scheme is a scheme.', '', 'Plan again, then PLAN.'))
  })

  it('replaces all of them, as one step that one undo takes back', () => {
    const state = run(searching(DOC, scheme()), replaceAll)

    expect(markdown(state)).toBe(lines('The scheme is a scheme.', '', 'scheme again, then scheme.'))
    expect(find(state).found.matches).toEqual([])
    let undone: EditorState | undefined
    undo(state, (tr) => {
      undone = state.apply(tr)
    })
    expect(undone === undefined ? '' : markdown(undone)).toBe(DOC)
  })

  it('takes the replacement apart for a regular expression, as VS Code does', () => {
    const state = run(
      searching(lines('Ada is here, Bob is there.'), {
        query: String.raw`(\w+) (is)`,
        replacement: '$2 $1',
        options: { regex: true },
      }),
      replaceAll,
    )

    expect(markdown(state)).toBe(lines('is Ada here, is Bob there.'))
  })

  it('follows the case of each match when asked to', () => {
    const state = run(searching(DOC, scheme({ options: { preserveCase: true } })), replaceAll)

    expect(markdown(state)).toBe(lines('The scheme is a scheme.', '', 'Scheme again, then SCHEME.'))
  })

  it('keeps the formatting of the words it replaces', () => {
    const state = run(searching(lines('Some **bold plan** here.'), scheme()), replaceAll)

    expect(markdown(state)).toBe(lines('Some **bold scheme** here.'))
  })

  it('replaces with nothing when the replacement is empty', () => {
    const state = run(searching(lines('a plan b'), { query: ' plan', replacement: '' }), replaceAll)

    expect(markdown(state)).toBe(lines('a b'))
  })

  it('replaces only within the selection when asked to', () => {
    const source = lines('plan one plan', '', 'plan two plan')
    const picked = select(open(source), 1, 14)
    const state = run(
      run(picked, openFind(true)),
      editFind({ query: 'plan', replacement: 'x', options: { inSelection: true } }),
    )

    expect(find(state).found.matches).toHaveLength(2)
    expect(markdown(run(state, replaceAll))).toBe(lines('x one x', '', 'plan two plan'))
  })

  describe('when the writer chooses something else while searching in a selection', () => {
    const SOURCE = lines('plan one plan', '', 'plan two plan', '', 'plan three plan')
    const searchingIn = () =>
      run(
        run(select(open(SOURCE), 1, 14), openFind(false)),
        editFind({ query: 'plan', options: { inSelection: true } }),
      )

    it('ends it on a click elsewhere, which selects nothing, and stops drawing the stretch', () => {
      const state = searchingIn()

      const clicked = select(state, 20)

      expect(find(clicked).settings.inSelection).toBe(false)
      expect(find(clicked).scope).toBeUndefined()
      expect(find(clicked).found.matches).toHaveLength(6)
      expect(drawn(clicked, 'scope')).toHaveLength(0)
    })

    it('follows a new selection, which becomes the stretch searched', () => {
      const reselected = select(searchingIn(), 16, 29)

      expect(find(reselected).settings.inSelection).toBe(true)
      expect(find(reselected).found.matches).toHaveLength(2)
      expect(drawn(reselected, 'scope')).toHaveLength(1)
    })

    it('is not ended by find moving the selection to a match', () => {
      const stepped = run(run(searchingIn(), findNext), findNext)

      expect(find(stepped).settings.inSelection).toBe(true)
      expect(find(stepped).scope).toEqual(find(searchingIn()).scope)
      expect(find(stepped).current).toBe(1)
    })

    it('is not ended by replacing a match and going on to the next', () => {
      let state = run(searchingIn(), editFind({ replacement: 'x' }))
      // The first press selects the first match, the next two replace it and then the second.
      for (let press = 0; press < 3; press += 1) state = run(state, replaceCurrent)

      expect(find(state).settings.inSelection).toBe(true)
      expect(markdown(state)).toBe(lines('x one x', '', 'plan two plan', '', 'plan three plan'))
    })
  })

  it('does not search in a selection when there is none to search in', () => {
    const state = searching(DOC, { query: 'plan', options: { inSelection: true } })

    expect(find(state).settings.inSelection).toBe(false)
    expect(find(state).found.matches).toHaveLength(4)
  })

  it('declines with nothing to replace', () => {
    expect(replaceAll(searching(DOC, 'zzz'))).toBe(false)
    expect(replaceCurrent(searching(DOC, 'zzz'))).toBe(false)
  })
})

describe('in an editor without find', () => {
  const without = harness.state(DOC)

  it('declines every command, which is for its keys to leave to the browser', () => {
    for (const command of [
      openFind(false),
      closeFind,
      editFind({ query: 'plan' }),
      findNext,
      findPrevious,
      replaceCurrent,
      replaceAll,
    ]) {
      expect(command(without)).toBe(false)
    }
  })
})

describe('after the last match is replaced', () => {
  it('has nowhere to go on to, and stays where the replacement left the caret', () => {
    const state = run(
      run(searching(lines('one plan only'), { query: 'plan', replacement: 'scheme' }), findNext),
      replaceCurrent,
    )

    expect(markdown(state)).toBe(lines('one scheme only'))
    expect(find(state).found.matches).toEqual([])
    expect(state.selection.empty).toBe(true)
  })

  it('keeps its stretch to search in while the replacement is edited', () => {
    const picked = select(open(lines('plan one plan')), 1, 14)
    const searched = run(
      run(picked, openFind(true)),
      editFind({ query: 'plan', options: { inSelection: true } }),
    )

    const edited = run(searched, editFind({ replacement: 'x' }))

    expect(find(edited).found.matches).toHaveLength(2)
    expect(find(edited).settings.inSelection).toBe(true)
  })

  it('leaves what it found alone when the caret moves and no match is selected either side', () => {
    const state = searching(DOC, 'plan')
    const moved = select(select(state, 1), 2)

    expect(find(moved).current).toBe(-1)
    expect(find(moved)).toBe(find(select(state, 1)))
  })
})

describe('asked whether they would run, without running', () => {
  it('say so for a replacement, and for all of them, and change nothing', () => {
    const selectedMatch = run(searching(DOC, { query: 'plan', replacement: 'x' }), findNext)

    expect(replaceCurrent(selectedMatch)).toBe(true)
    expect(replaceAll(selectedMatch)).toBe(true)
  })

  it('wrap round to the first match when the last is replaced', () => {
    const second = run(
      run(searching(lines('plan one plan'), { query: 'plan', replacement: 'x' }), findNext),
      findNext,
    )
    const state = run(second, replaceCurrent)

    expect(markdown(state)).toBe(lines('plan one x'))
    expect(selected(state)).toBe('plan')
  })
})
