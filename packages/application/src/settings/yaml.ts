import { parse, stringify } from 'yaml'

import { BRAND } from '@quill/brand'

import {
  parseOrganisationSettings,
  parseWorkspaceSettings,
  type OrganisationSettings,
  type WorkspaceSettings,
} from './documents.ts'

/**
 * The on-disk form of a settings document: YAML, because a person who clones
 * the content store should be able to read what their organisation is
 * configured to do (ADR-034).
 *
 * Encoding is deterministic — the same document always produces the same
 * bytes — because those bytes are the compare-and-swap expectation the
 * content store checks a write against. Long values are never folded, since a
 * folded line changes with the surrounding indentation rather than with the
 * value.
 */

const HEADER = [
  `# Managed by ${BRAND.name}.`,
  '# Edited in the product; this file is its record, with history and authors.',
  '# It never contains a secret value: secrets are referenced by name.',
  '',
].join('\n')

export function encodeSettings(document: OrganisationSettings | WorkspaceSettings): string {
  return `${HEADER}${stringify(document, { lineWidth: 0 })}`
}

export type SettingsDecode<T> =
  | { readonly kind: 'settings'; readonly document: T }
  /** Well-formed YAML this release has no reader for, or one that fails its schema. */
  | { readonly kind: 'unreadable'; readonly reason: string }

function decode<T>(text: string, read: (value: unknown) => T | null): SettingsDecode<T> {
  let value: unknown
  try {
    value = parse(text)
  } catch (error) {
    return { kind: 'unreadable', reason: `it is not valid YAML: ${String(error)}` }
  }
  const document = read(value)
  return document === null
    ? {
        kind: 'unreadable',
        reason: 'no reader in this release understands its version or its shape',
      }
    : { kind: 'settings', document }
}

export function decodeOrganisationSettings(text: string): SettingsDecode<OrganisationSettings> {
  return decode(text, parseOrganisationSettings)
}

export function decodeWorkspaceSettings(text: string): SettingsDecode<WorkspaceSettings> {
  return decode(text, parseWorkspaceSettings)
}
