import { revisionId, type RevisionId, type WorkspaceId } from '@quill/domain'

import type {
  Settings,
  SettingsRead,
  SettingsWrite,
  WriteSettingsInput,
} from '../ports/settings.ts'
import type { OrganisationSettings, WorkspaceSettings } from '../settings/documents.ts'
import {
  decodeOrganisationSettings,
  decodeWorkspaceSettings,
  encodeSettings,
  type SettingsDecode,
} from '../settings/yaml.ts'

/**
 * An in-memory `Settings` for unit tests of the use cases.
 *
 * It keeps the *encoded* file rather than the object, and decodes it with the
 * real reader, which is what makes it a useful fake rather than a `Map` with
 * extra steps: a file planted by `place` is read exactly as the content-store
 * adapter would read it, including being refused when this release has no
 * reader for it. Revisions count up, because their only job above the port is
 * to be compared for equality.
 */

export interface FakeSettings extends Settings {
  /** Put a file there directly, as another server would have. */
  place(path: 'organisation' | WorkspaceId, text: string): RevisionId
  /** The raw file at a path, for a test that asserts what was written. */
  fileAt(path: 'organisation' | WorkspaceId): string | undefined
  /** Every write this fake accepted, in order. */
  readonly writes: readonly { readonly path: string; readonly changeNote?: string }[]
}

const ORGANISATION = 'organisation'

export function createFakeSettings(): FakeSettings {
  const files = new Map<string, string>()
  const writtenAt = new Map<string, RevisionId>()
  const writes: { path: string; changeNote?: string }[] = []
  let revisions = 0

  const nextRevision = (): RevisionId => {
    revisions += 1
    return revisionId(revisions.toString(16).padStart(40, '0'))
  }

  const read = <T>(path: string, decode: (text: string) => SettingsDecode<T>): SettingsRead<T> => {
    const text = files.get(path)
    const revision = writtenAt.get(path)
    if (text === undefined || revision === undefined) return { kind: 'unset' }
    const decoded = decode(text)
    return decoded.kind === 'settings'
      ? { kind: 'settings', document: decoded.document, revision }
      : { kind: 'unreadable', reason: decoded.reason, revision }
  }

  const write = <T extends OrganisationSettings | WorkspaceSettings>(
    path: string,
    input: WriteSettingsInput<T>,
    decode: (text: string) => SettingsDecode<T>,
  ): SettingsWrite<T> => {
    if ((writtenAt.get(path) ?? null) !== input.expectedRevision) {
      return { kind: 'conflict', current: read(path, decode) }
    }
    const revision = nextRevision()
    files.set(path, encodeSettings(input.document))
    writtenAt.set(path, revision)
    writes.push({
      path,
      ...(input.changeNote === undefined ? {} : { changeNote: input.changeNote }),
    })
    return { kind: 'written', document: input.document, revision }
  }

  return {
    place(path, text) {
      const revision = nextRevision()
      files.set(path, text)
      writtenAt.set(path, revision)
      return revision
    },
    fileAt(path) {
      return files.get(path)
    },
    writes,

    async readOrganisation() {
      return read(ORGANISATION, decodeOrganisationSettings)
    },
    async writeOrganisation(input) {
      return write(ORGANISATION, input, decodeOrganisationSettings)
    },
    async readWorkspace(workspaceId) {
      return read(workspaceId, decodeWorkspaceSettings)
    },
    async writeWorkspace(workspaceId, input) {
      return write(workspaceId, input, decodeWorkspaceSettings)
    },
  }
}
