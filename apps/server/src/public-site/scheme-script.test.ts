import { describe, expect, it } from 'vitest'

import { createHasher } from '../infrastructure/hasher.ts'
import {
  ANIMATED_IMAGES_STORAGE_KEY,
  createSchemeScript,
  SCHEME_SCRIPT,
  SCHEME_STORAGE_KEY,
} from './scheme-script.ts'

/**
 * The public site's one script: the reader's colour scheme, applied before
 * first paint, and the switch that changes it (ADR-028: the scheme belongs to
 * the reader).
 *
 * It runs in a browser and nowhere else, so it is exercised here against the
 * handful of browser objects it touches, standing in for the real ones.
 */

interface FakeInput {
  readonly value: string
  checked: boolean
  listener?: () => void
  addEventListener(type: string, listener: () => void): void
}

function fakeInput(value: string): FakeInput {
  return {
    value,
    checked: false,
    addEventListener(_type, listener) {
      this.listener = listener
    },
  }
}

function browser(options: {
  stored?: string | null
  animatedImages?: string
  storageThrows?: boolean
  narrow?: boolean
}) {
  const attributes = new Map<string, string>()
  const stored = new Map<string, string>()
  if (options.stored !== undefined && options.stored !== null) {
    stored.set(SCHEME_STORAGE_KEY, options.stored)
  }
  if (options.animatedImages !== undefined) {
    stored.set(ANIMATED_IMAGES_STORAGE_KEY, options.animatedImages)
  }
  const inputs = ['system', 'light', 'dark'].map(fakeInput)
  const schemeSwitch = { hidden: true }
  const menu = { open: true }
  let widthListener: ((event: { matches: boolean }) => void) | undefined
  const windowListeners = new Map<string, (event: { key: string }) => void>()

  const document = {
    readyState: 'complete',
    documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
    querySelectorAll: (selector: string) => (selector.includes('site-scheme') ? inputs : []),
    querySelector: (selector: string) =>
      selector === '.site-scheme' ? schemeSwitch : selector === '.site-menu' ? menu : null,
    addEventListener: () => undefined,
  }
  const localStorage = {
    getItem: (key: string) => {
      if (options.storageThrows === true) throw new Error('blocked')
      return stored.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (options.storageThrows === true) throw new Error('blocked')
      stored.set(key, value)
    },
  }
  const matchMedia = () => ({
    matches: options.narrow === true,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      widthListener = listener
    },
  })
  const addEventListener = (type: string, listener: (event: { key: string }) => void) => {
    windowListeners.set(type, listener)
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script under test is a string served to browsers.
  new Function('document', 'localStorage', 'matchMedia', 'addEventListener', SCHEME_SCRIPT)(
    document,
    localStorage,
    matchMedia,
    addEventListener,
  )

  return {
    scheme: () => attributes.get('data-theme') ?? null,
    animatedImages: () => attributes.get('data-animated-images') ?? null,
    stored,
    inputs,
    schemeSwitch,
    menu,
    widen: () => widthListener?.({ matches: false }),
    storageEvent: (key: string) => windowListeners.get('storage')?.({ key }),
  }
}

describe('the colour scheme script', () => {
  it('leaves the system in charge until the reader chooses', () => {
    const page = browser({})
    expect(page.scheme()).toBeNull()
    expect(page.inputs.find((input) => input.checked)?.value).toBe('system')
  })

  it('applies a remembered choice before anything is drawn', () => {
    expect(browser({ stored: 'dark' }).scheme()).toBe('dark')
    expect(browser({ stored: 'light' }).scheme()).toBe('light')
  })

  it('ignores a stored value it does not recognise', () => {
    expect(browser({ stored: '"><script>' }).scheme()).toBeNull()
  })

  it('still works, unremembered, when site data is blocked', () => {
    const page = browser({ storageThrows: true })
    expect(page.scheme()).toBeNull()
    page.inputs[2]?.listener?.()
    expect(page.scheme()).toBe('dark')
  })

  it('shows the switch only once the script is running, and remembers what is chosen', () => {
    const page = browser({})
    expect(page.schemeSwitch.hidden).toBe(false)
    page.inputs[2]?.listener?.()
    expect(page.scheme()).toBe('dark')
    expect(page.stored.get(SCHEME_STORAGE_KEY)).toBe('dark')
    page.inputs[0]?.listener?.()
    expect(page.scheme()).toBeNull()
  })

  it('follows a choice made in another tab', () => {
    const page = browser({})
    page.stored.set(SCHEME_STORAGE_KEY, 'light')
    page.storageEvent(SCHEME_STORAGE_KEY)
    expect(page.scheme()).toBe('light')
    expect(page.inputs.find((input) => input.checked)?.value).toBe('light')
  })

  it('folds the documents on a narrow screen, and unfolds them when it widens', () => {
    const page = browser({ narrow: true })
    expect(page.menu.open).toBe(false)
    page.widen()
    expect(page.menu.open).toBe(true)
    expect(browser({}).menu.open).toBe(true)
  })
})

describe('the animated images preference', () => {
  it('is the application’s key, so a member’s choice follows them onto the public site', () => {
    expect(ANIMATED_IMAGES_STORAGE_KEY).toBe('animated-images-preference')
  })

  it('applies a remembered preference to the document element', () => {
    expect(browser({ animatedImages: 'never' }).animatedImages()).toBe('never')
    expect(browser({ animatedImages: 'hover' }).animatedImages()).toBe('hover')
    expect(browser({ animatedImages: 'brief' }).animatedImages()).toBe('brief')
  })

  it('leaves the attribute absent, which is the default, when nothing usable is stored', () => {
    expect(browser({}).animatedImages()).toBeNull()
    expect(browser({ animatedImages: '"><script>' }).animatedImages()).toBeNull()
    expect(browser({ animatedImages: 'never', storageThrows: true }).animatedImages()).toBeNull()
  })
})

describe('the script asset', () => {
  it('is addressed by its own hash, so it can be cached for ever', () => {
    const script = createSchemeScript(createHasher())
    expect(script.href).toBe(`/s/_assets/scheme-${script.hash}.js`)
    expect(script.hash).toMatch(/^[0-9a-f]{32}$/u)
    expect(script.source).toBe(SCHEME_SCRIPT)
  })
})
