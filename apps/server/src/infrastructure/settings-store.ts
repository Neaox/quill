import {
  decodeOrganisationSettings,
  decodeWorkspaceSettings,
  encodeSettings,
  ORGANISATION_SETTINGS_PATH,
  SYSTEM_WORKSPACE_ID,
  workspaceSettingsPath,
} from '@quill/application'
import type {
  ContentFile,
  ContentStore,
  OrganisationSettings,
  Settings,
  SettingsDecode,
  SettingsRead,
  SettingsWrite,
  WorkspaceSettings,
  WriteSettingsInput,
} from '@quill/application'
import type { WorkspaceId } from '@quill/domain'

/**
 * The settings store, as files in the content store (ADR-034).
 *
 * This is the whole adapter: YAML in, YAML out, and the content store's
 * file-level compare-and-swap in between. It is an adapter rather than a
 * repository in the Postgres sense, so it lives here beside the content store
 * it wraps rather than in `repositories/`.
 *
 * The compare-and-swap deserves its explanation. A caller states the revision
 * it read at, and this reads the file *as it stood at that revision* to
 * recover the exact bytes the caller's change was based on. Those bytes are
 * the expectation the store checks against the current file. Comparing bytes
 * rather than revisions matters: the revision is the whole system workspace's,
 * and it moves whenever any workspace's settings change, so comparing
 * revisions would have two administrators configuring two different workspaces
 * collide with each other for no reason.
 */
export function createSettingsStore(contentStore: ContentStore): Settings {
  const read = async <T>(
    path: string,
    decode: (text: string) => SettingsDecode<T>,
  ): Promise<SettingsRead<T>> => {
    const file = await contentStore.readFile(SYSTEM_WORKSPACE_ID, path)
    return file === null ? { kind: 'unset' } : toRead(file, decode)
  }

  const write = async <T extends OrganisationSettings | WorkspaceSettings>(
    path: string,
    summary: string,
    input: WriteSettingsInput<T>,
    decode: (text: string) => SettingsDecode<T>,
  ): Promise<SettingsWrite<T>> => {
    const based =
      input.expectedRevision === null
        ? null
        : await contentStore.readFile(SYSTEM_WORKSPACE_ID, path, input.expectedRevision)
    const result = await contentStore.putFile({
      workspaceId: SYSTEM_WORKSPACE_ID,
      path,
      text: encodeSettings(input.document),
      expected: based?.text ?? null,
      author: input.author,
      summary,
      ...(input.changeNote === undefined ? {} : { changeNote: input.changeNote }),
    })
    // Re-read rather than decode what the store handed back: it costs one
    // read on a path that is already refusing the write, and it keeps "what
    // does this file say now" in one place.
    if (result.kind === 'stale') return { kind: 'conflict', current: await read(path, decode) }
    return { kind: 'written', document: input.document, revision: result.revision }
  }

  return {
    async readOrganisation() {
      return await read(ORGANISATION_SETTINGS_PATH, decodeOrganisationSettings)
    },

    async writeOrganisation(input) {
      return await write(
        ORGANISATION_SETTINGS_PATH,
        'Update organisation settings',
        input,
        decodeOrganisationSettings,
      )
    },

    async readWorkspace(workspaceId: WorkspaceId) {
      return await read(workspaceSettingsPath(workspaceId), decodeWorkspaceSettings)
    },

    async writeWorkspace(workspaceId: WorkspaceId, input) {
      return await write(
        workspaceSettingsPath(workspaceId),
        `Update settings for workspace ${workspaceId}`,
        input,
        decodeWorkspaceSettings,
      )
    },
  }
}

function toRead<T>(
  file: ContentFile,
  decode: (text: string) => SettingsDecode<T>,
): SettingsRead<T> {
  const decoded = decode(file.text)
  return decoded.kind === 'settings'
    ? { kind: 'settings', document: decoded.document, revision: file.revision }
    : { kind: 'unreadable', reason: decoded.reason, revision: file.revision }
}
