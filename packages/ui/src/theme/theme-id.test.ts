import { describe, expect, it } from 'vitest'

import { DEFAULT_THEME, OFFERED_THEME_IDS } from '@quill/theme'

import {
  applyThemeId,
  DEFAULT_THEME_ID,
  isThemeId,
  THEME_ID_ATTRIBUTE,
  THEME_IDS,
  themeIdName,
  themeIdVariants,
} from './theme-id.ts'

describe('theme identity', () => {
  it('offers exactly the built-in identities that are still offered', () => {
    expect(THEME_IDS).toEqual(OFFERED_THEME_IDS)
    expect(THEME_IDS).not.toContain('press')
  })

  it('agrees with the theme package about which identity is the default', () => {
    expect(DEFAULT_THEME.id).toBe(DEFAULT_THEME_ID)
  })

  it('recognises an identity and rejects anything else', () => {
    expect(isThemeId('press')).toBe(true)
    expect(isThemeId('instrument')).toBe(true)
    expect(isThemeId('atelier')).toBe(true)
    expect(isThemeId('calm')).toBe(true)
    expect(isThemeId('editorial')).toBe(true)
    expect(isThemeId('grid')).toBe(true)
    expect(isThemeId('bauhaus')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
  })

  it('names each identity from its own theme document', () => {
    expect(themeIdName('instrument')).toBe('Instrument')
    expect(themeIdName('atelier')).toBe('Atelier')
    expect(themeIdName('calm')).toBe('Calm')
    expect(themeIdName('editorial')).toBe('Editorial')
    expect(themeIdName('grid')).toBe('Grid')
  })

  it('names a superseded identity after the theme that replaced it', () => {
    expect(themeIdName('press')).toBe('Editorial')
  })

  it('reports each identity signature variants', () => {
    expect(themeIdVariants('instrument')).toEqual({
      comments: 'panel',
      history: 'timeline',
      navigation: 'tree',
      header: 'readout',
      rules: 'hairline',
    })
    expect(themeIdVariants('editorial').comments).toBe('sidenotes')
    expect(themeIdVariants('press')).toEqual(themeIdVariants('editorial'))
    expect(themeIdVariants('atelier').navigation).toBe('tabs')
  })
})

describe('applyThemeId', () => {
  it('writes a non-default identity onto the element', () => {
    const element = document.createElement('html')

    applyThemeId(element, 'press')

    expect(element.getAttribute(THEME_ID_ATTRIBUTE)).toBe('press')
  })

  it('removes the attribute for the default identity, because absence is it', () => {
    const element = document.createElement('html')
    element.setAttribute(THEME_ID_ATTRIBUTE, 'atelier')

    applyThemeId(element, DEFAULT_THEME_ID)

    expect(element.hasAttribute(THEME_ID_ATTRIBUTE)).toBe(false)
  })
})
