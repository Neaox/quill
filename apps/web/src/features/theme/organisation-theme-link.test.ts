import { afterEach, describe, expect, it } from 'vitest'

import { createOrganisationThemeLink } from './organisation-theme-link.ts'

const PRESS = {
  themeId: 'press',
  stylesheetHref: '/api/settings/organisation/theme.css?v=a',
  attributes: { 'data-rules': 'double' },
}
const CUSTOM = { ...PRESS, stylesheetHref: '/api/settings/organisation/theme.css?v=b' }
const GRID = {
  themeId: 'grid',
  stylesheetHref: '/api/settings/organisation/theme.css?v=c',
  attributes: { 'data-rules': 'plain', 'data-align': 'start' },
}
const CALM = {
  themeId: 'calm',
  stylesheetHref: '/api/settings/organisation/theme.css?v=d',
  attributes: { 'data-rules': 'plain' },
}

const links = () => [...document.head.querySelectorAll('link[data-organisation-theme]')]
const hrefs = () => links().map((link) => link.getAttribute('href'))
const identity = () => document.documentElement.getAttribute('data-theme-id')
const settle = (event: 'load' | 'error') => links().at(-1)?.dispatchEvent(new Event(event))

afterEach(() => {
  for (const link of links()) link.remove()
  for (const name of ['data-theme-id', 'data-rules', 'data-align']) {
    document.documentElement.removeAttribute(name)
  }
})

describe('the organisation’s theme on the page', () => {
  it('links the stylesheet, and names the identity once it has arrived', () => {
    createOrganisationThemeLink(document).apply(PRESS)

    expect(hrefs()).toEqual([PRESS.stylesheetHref])
    expect(links()[0]?.getAttribute('rel')).toBe('stylesheet')
    // Not before: the identity and the palette scoped to it change together.
    expect(identity()).toBeNull()

    settle('load')
    expect(identity()).toBe('press')
  })

  it('swaps to a saved theme without a moment of neither: the old sheet stays until the new one loads', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    settle('load')

    theme.apply(CALM)
    expect(hrefs()).toEqual([PRESS.stylesheetHref, CALM.stylesheetHref])
    expect(identity()).toBe('press')

    settle('load')
    expect(hrefs()).toEqual([CALM.stylesheetHref])
    expect(identity()).toBe('calm')
  })

  it('keeps the theme it has when the next one cannot be loaded', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    settle('load')

    theme.apply(CUSTOM)
    settle('error')

    expect(hrefs()).toEqual([PRESS.stylesheetHref])
    expect(identity()).toBe('press')
  })

  it('abandons a sheet still loading when another is asked for, so a slow one never lands last', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    theme.apply(CALM)

    expect(hrefs()).toEqual([CALM.stylesheetHref])
    settle('load')
    expect(identity()).toBe('calm')
  })

  it('does nothing for the stylesheet it already has', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    settle('load')
    const linked = links()[0]

    theme.apply(PRESS)
    expect(links()).toEqual([linked])
  })

  it('writes the layout attributes with the identity, and takes back the ones a new theme drops', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(GRID)
    expect(document.documentElement).not.toHaveAttribute('data-rules')
    settle('load')
    expect(document.documentElement).toHaveAttribute('data-rules', 'plain')
    expect(document.documentElement).toHaveAttribute('data-align', 'start')

    theme.apply(CALM)
    settle('load')
    expect(document.documentElement).toHaveAttribute('data-rules', 'plain')
    expect(document.documentElement).not.toHaveAttribute('data-align')
  })

  it('moves a layout attribute that changed while the stylesheet did not', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    settle('load')
    theme.apply({ ...PRESS, attributes: { 'data-rules': 'cards' } })
    expect(document.documentElement).toHaveAttribute('data-rules', 'cards')
  })

  it('writes nothing that is not a data- attribute', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply({ ...PRESS, attributes: { onclick: 'x()', style: 'color: red' } })
    settle('load')
    expect(document.documentElement).not.toHaveAttribute('onclick')
    expect(document.documentElement).not.toHaveAttribute('style')
  })

  it('takes everything back off the page when it is disposed', () => {
    const theme = createOrganisationThemeLink(document)
    theme.apply(PRESS)
    settle('load')
    theme.apply(CALM)

    theme.dispose()
    expect(links()).toEqual([])
    expect(identity()).toBeNull()
    expect(document.documentElement).not.toHaveAttribute('data-rules')
  })
})
