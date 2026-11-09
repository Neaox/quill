import { describe, expect, it } from 'vitest'

import {
  MAX_FORGE_VIEW_TEMPLATE_LENGTH,
  checkForgeViewTemplate,
  defaultForgeViewTemplate,
  forgeViewUrl,
} from './forge-links.ts'

describe('checkForgeViewTemplate', () => {
  it('accepts an https address naming the commit and the path in its path', () => {
    const template = 'https://git.example.com/team/handbook/src/{commit}/{path}'
    expect(checkForgeViewTemplate(template)).toEqual({ ok: true, value: template })
  })

  it.each([
    ['https://git.example.com/{commit}', 'once each'],
    ['https://git.example.com/{commit}/{path}/{path}', 'once each'],
    ['https://git.example.com/{ref}/{commit}/{path}', 'in braces'],
    ['https://exa mple.com/{commit}/{path}', 'not an address'],
    ['http://git.example.com/{commit}/{path}', 'https://'],
    ['https:git.example.com/{commit}/{path}', 'https://'],
    ['https://ada:secret@git.example.com/{commit}/{path}', 'user name or password'],
    ['https://git.example.com/{commit}/{path}?plain=1', 'query or a fragment'],
    ['https://git.example.com/{commit}/{path}#top', 'query or a fragment'],
    ['https://{commit}.example.com/{path}', 'after its host'],
  ])('refuses %s', (template, message) => {
    expect(checkForgeViewTemplate(template)).toEqual({
      ok: false,
      error: expect.stringContaining(message),
    })
  })

  it('refuses an address longer than the limit', () => {
    const long = `https://git.example.com/${'a'.repeat(MAX_FORGE_VIEW_TEMPLATE_LENGTH)}/{commit}/{path}`
    expect(checkForgeViewTemplate(long).ok).toBe(false)
  })
})

describe('defaultForgeViewTemplate', () => {
  it.each([
    [
      'https://github.com/acme/handbook.git',
      'https://github.com/acme/handbook/blob/{commit}/{path}',
    ],
    ['https://github.com/acme/handbook/', 'https://github.com/acme/handbook/blob/{commit}/{path}'],
    [
      'https://gitlab.com/acme/docs/handbook.git',
      'https://gitlab.com/acme/docs/handbook/-/blob/{commit}/{path}',
    ],
    [
      'https://bitbucket.org/acme/handbook',
      'https://bitbucket.org/acme/handbook/src/{commit}/{path}',
    ],
  ])('knows the address of %s', (remote, template) => {
    expect(defaultForgeViewTemplate(remote)).toBe(template)
  })

  it.each([
    'not an address',
    'file:///srv/handbook.git',
    'https://github.com/acme',
    'https://git.example.com/acme/handbook.git',
  ])('has none for %s', (remote) => {
    expect(defaultForgeViewTemplate(remote)).toBeNull()
  })
})

describe('forgeViewUrl', () => {
  it('fills the commit and encodes each segment of the path', () => {
    expect(
      forgeViewUrl(
        'https://github.com/acme/handbook/blob/{commit}/{path}',
        'abc123',
        'docs/a b/ü?.md',
      ),
    ).toBe('https://github.com/acme/handbook/blob/abc123/docs/a%20b/%C3%BC%3F.md')
  })
})
