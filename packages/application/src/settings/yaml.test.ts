import { describe, expect, it } from 'vitest'

import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  ORGANISATION_SETTINGS_VERSION,
  SETTINGS_VERSION,
} from './documents.ts'
import { decodeOrganisationSettings, decodeWorkspaceSettings, encodeSettings } from './yaml.ts'

const organisation = defaultOrganisationSettings()

describe('encoding', () => {
  it('round trips an organisation document', () => {
    const decoded = decodeOrganisationSettings(encodeSettings(organisation))
    expect(decoded).toEqual({ kind: 'settings', document: organisation })
  })

  it('round trips a workspace document with an override', () => {
    const workspace = {
      ...defaultWorkspaceSettings('w-1'),
      layout: organisation.layout.default,
    }
    expect(decodeWorkspaceSettings(encodeSettings(workspace))).toEqual({
      kind: 'settings',
      document: workspace,
    })
  })

  it('is deterministic, because the bytes are the compare-and-swap expectation', () => {
    expect(encodeSettings(organisation)).toBe(encodeSettings(defaultOrganisationSettings()))
  })

  it('says in the file itself that it holds no secret value', () => {
    const text = encodeSettings(organisation)
    expect(text.startsWith('#')).toBe(true)
    expect(text).toContain('referenced by name')
  })

  it('never folds a long value across lines', () => {
    const long = 'x'.repeat(300)
    const text = encodeSettings({
      ...organisation,
      publicMenu: [{ kind: 'url', label: 'Handbook', href: `/docs/${long}` }],
    })
    expect(text).toContain(`/docs/${long}`)
  })
})

describe('decoding', () => {
  it('reports YAML that does not parse', () => {
    const decoded = decodeOrganisationSettings('name: [unterminated\n')
    expect(decoded).toMatchObject({ kind: 'unreadable' })
    if (decoded.kind === 'settings') throw new Error('expected it to be unreadable')
    expect(decoded.reason).toContain('not valid YAML')
  })

  it('reports a version no shipped reader understands', () => {
    const decoded = decodeOrganisationSettings(`version: ${SETTINGS_VERSION + 1}\nname: Acme\n`)
    expect(decoded).toMatchObject({
      kind: 'unreadable',
      reason: expect.stringContaining('version'),
    })
  })

  it('reports a document that fails its schema', () => {
    expect(decodeWorkspaceSettings(`version: ${SETTINGS_VERSION}\n`)).toMatchObject({
      kind: 'unreadable',
    })
  })
})

describe('the format corpus (ADR-033)', () => {
  it('reads a version 1 file as written, its navigation links kept as menu links', async () => {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(new URL('./corpus/organisation.v1.yaml', import.meta.url), 'utf8')
    const decoded = decodeOrganisationSettings(text)
    if (decoded.kind !== 'settings') throw new Error(`unreadable: ${decoded.reason}`)
    expect(decoded.document.version).toBe(ORGANISATION_SETTINGS_VERSION)
    expect(decoded.document.name).toBe('Acme')
    expect(decoded.document.publicMenu).toEqual([
      { kind: 'url', href: '/handbook', label: 'Handbook' },
      { kind: 'url', href: 'https://status.example.com', label: 'Status' },
    ])
  })

  it('writes the current version back, so a version 1 file is upgraded on its next save', async () => {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(new URL('./corpus/organisation.v1.yaml', import.meta.url), 'utf8')
    const decoded = decodeOrganisationSettings(text)
    if (decoded.kind !== 'settings') throw new Error('unreadable')
    const rewritten = encodeSettings(decoded.document)
    expect(rewritten).toContain(`version: ${ORGANISATION_SETTINGS_VERSION}`)
    expect(rewritten).not.toContain('publicNavigation')
    expect(decodeOrganisationSettings(rewritten)).toEqual(decoded)
  })
})
