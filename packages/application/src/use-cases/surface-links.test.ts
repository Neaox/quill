import { describe, expect, it } from 'vitest'

import { shortId } from '@quill/domain'
import type { DocumentId } from '@quill/domain'

import { surfaceLinkRewriter, surfaceReplacement } from './surface-links.ts'

const PUBLISHED = {
  id: '11111111-2222-4333-8444-555555555555' as DocumentId,
  shortId: shortId('k7m3q9v2rt'),
  path: 'guide/setup',
}
const PRIVATE_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa'

const rewrite = surfaceLinkRewriter([PUBLISHED], (document) => `/s/docs/${document.path}`)

describe('surfaceLinkRewriter', () => {
  it('sends a canonical id link to a document this surface shows to its address there', () => {
    expect(rewrite(`/d/${PUBLISHED.id}`)).toEqual({ kind: 'href', href: '/s/docs/guide/setup' })
  })

  it('resolves the readable forms by their key, whatever the words and the workspace say', () => {
    for (const href of [
      `/d/${PUBLISHED.shortId}`,
      `/d/an-old-title-${PUBLISHED.shortId}`,
      `/w/engineering/d/setup-${PUBLISHED.shortId}`,
    ]) {
      expect(rewrite(href)).toEqual({ kind: 'href', href: '/s/docs/guide/setup' })
    }
  })

  it('carries the section and the query over, because they say where on the page to land', () => {
    expect(rewrite(`/d/${PUBLISHED.id}#user-content-install`)).toEqual({
      kind: 'href',
      href: '/s/docs/guide/setup#user-content-install',
    })
    expect(rewrite(`/d/${PUBLISHED.shortId}?tab=python#run`)).toEqual({
      kind: 'href',
      href: '/s/docs/guide/setup?tab=python#run',
    })
  })

  it('reduces a link to a document this surface does not show to its words', () => {
    expect(rewrite(`/d/${PRIVATE_ID}`)).toEqual({ kind: 'text' })
    expect(rewrite(`/w/engineering/d/secret-plans-p4n8w2cx5b#costs`)).toEqual({ kind: 'text' })
  })

  it('reduces any other address into the application to its words, since it leads nowhere here', () => {
    expect(rewrite('/w/engineering')).toEqual({ kind: 'text' })
    expect(rewrite('/d/not-a-reference')).toEqual({ kind: 'text' })
  })

  it('leaves everything that is not an address into the application alone', () => {
    for (const href of [
      'https://example.com/d/k7m3q9v2rt',
      '#user-content-install',
      'mailto:someone@example.com',
      '/s/docs/guide/setup',
      '/api/attachments/abc',
      'relative/page',
    ]) {
      expect(rewrite(href)).toEqual({ kind: 'keep' })
    }
  })
})

describe('surfaceLinkRewriter, for an address written as a browser would read it', () => {
  const APP = 'https://quill.example.com'
  const own = surfaceLinkRewriter([PUBLISHED], (document) => `/s/docs/${document.path}`, [APP])

  it('treats an absolute address of the application as its own, in any form a browser opens', () => {
    for (const origin of [
      APP,
      'http://quill.example.com',
      'https://www.quill.example.com',
      'http://WWW.Quill.Example.com',
      '//quill.example.com',
    ]) {
      expect(own(`${origin}/d/${PRIVATE_ID}`)).toEqual({ kind: 'text' })
      expect(own(`${origin}/w/engineering/d/setup-${PUBLISHED.shortId}#run`)).toEqual({
        kind: 'href',
        href: '/s/docs/guide/setup#run',
      })
    }
  })

  it('reads the path as a browser does: its case, its backslashes, its surrounding space', () => {
    for (const href of [
      `/D/${PRIVATE_ID}`,
      `/W/engineering/D/${PRIVATE_ID}`,
      ` /d/${PRIVATE_ID}`,
      `\t/d/${PRIVATE_ID}\n`,
      `\\d\\${PRIVATE_ID}`,
      `${APP}/W/engineering`,
    ]) {
      expect(own(href)).toEqual({ kind: 'text' })
    }
    expect(own(` /D/${PUBLISHED.id}`)).toEqual({ kind: 'href', href: '/s/docs/guide/setup' })
  })

  it('leaves another site that merely looks like the application alone', () => {
    for (const href of [
      `https://quill.example.com.evil.example/d/${PRIVATE_ID}`,
      `https://evil.example/d/${PRIVATE_ID}`,
      `https://quill.example.com:8443/d/${PRIVATE_ID}`,
      `ftp://quill.example.com/d/${PRIVATE_ID}`,
      'https://[::1',
    ]) {
      expect(own(href)).toEqual({ kind: 'keep' })
    }
  })
})

describe('surfaceReplacement', () => {
  const pages = [{ ...PUBLISHED, title: 'Setting up' }]
  const replacement = (reference: string | undefined) =>
    surfaceReplacement(reference, pages, (document) => `/s/docs/${document.path}`)

  it('names a replacement this surface shows, at its address here, by any of its handles', () => {
    for (const reference of [PUBLISHED.id, PUBLISHED.shortId, `setting-up-${PUBLISHED.shortId}`]) {
      expect(replacement(reference)).toEqual({ href: '/s/docs/guide/setup', title: 'Setting up' })
    }
  })

  it('says nothing of a replacement the surface does not show, or of a reference that names nothing', () => {
    expect(replacement(PRIVATE_ID)).toBeUndefined()
    expect(replacement('not a reference')).toBeUndefined()
    expect(replacement(undefined)).toBeUndefined()
  })
})
