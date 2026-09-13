import { runThemeDoctor, type ThemeReport } from '@quill/theme'
import type { RevisionId, UserId, WorkspaceId } from '@quill/domain'

import type { ContentAuthor } from '../ports/content-store.ts'
import type { UnitOfWork } from '../ports/persistence.ts'
import type { Settings, SettingsRead } from '../ports/settings.ts'
import type { Clock, IdGenerator } from '../ports/system.ts'
import {
  defaultOrganisationSettings,
  defaultWorkspaceSettings,
  validateOrganisationSettings,
  validateWorkspaceSettings,
  type OrganisationSettings,
  type SettingsIssue,
  type WorkspaceSettings,
} from '../settings/documents.ts'
import { resolveEffectiveSettings, type EffectiveSettings } from '../settings/resolve.ts'

/**
 * Reading and changing what an organisation configured (ADR-034, ADR-028).
 *
 * Each is a command with a `Result`-shaped answer: the route maps outcomes to
 * status codes and decides nothing itself, and permission is checked at the
 * route the way every other administrative action's is (`requireInstanceAdmin`
 * for the organisation, `manage` on the workspace for a workspace).
 *
 * The theme doctor's report travels back with a successful update and never
 * refuses one. ADR-028 is explicit that the doctor **advises**: a tenant may
 * keep a warned value, and the one rule enforced by default — AA text
 * contrast — is enforced in the theme editor, in front of the administrator
 * who can see the reason and who may switch that enforcement to advisory.
 * Refusing the write here would put the decision somewhere nobody can see it.
 */

export const SETTINGS_AUDIT_EVENTS = {
  organisationUpdated: 'settings.organisation.updated',
  workspaceUpdated: 'settings.workspace.updated',
} as const

export interface SettingsDependencies {
  readonly settings: Settings
  readonly uow: UnitOfWork
  readonly clock: Clock
  readonly ids: IdGenerator
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ReadSettingsResult<T> =
  | { readonly kind: 'settings'; readonly document: T; readonly revision: RevisionId | null }
  | { readonly kind: 'unreadable'; readonly reason: string; readonly revision: RevisionId }

/**
 * The organisation's settings, or the defaults when nobody has saved any.
 *
 * A `null` revision says exactly that: nothing is stored, so a write states
 * `null` as its expectation and creates the file. An *unreadable* file is not
 * folded into the defaults — see `SettingsRead`.
 */
export async function readOrganisationSettings(
  deps: SettingsDependencies,
): Promise<ReadSettingsResult<OrganisationSettings>> {
  return fromRead(await deps.settings.readOrganisation(), () => defaultOrganisationSettings())
}

export async function readWorkspaceSettings(
  deps: SettingsDependencies,
  workspaceId: WorkspaceId,
): Promise<ReadSettingsResult<WorkspaceSettings>> {
  return fromRead(await deps.settings.readWorkspace(workspaceId), () =>
    defaultWorkspaceSettings(workspaceId),
  )
}

function fromRead<T>(read: SettingsRead<T>, fallback: () => T): ReadSettingsResult<T> {
  switch (read.kind) {
    case 'settings':
      return { kind: 'settings', document: read.document, revision: read.revision }
    case 'unset':
      return { kind: 'settings', document: fallback(), revision: null }
    case 'unreadable':
      return { kind: 'unreadable', reason: read.reason, revision: read.revision }
  }
}

export type EffectiveSettingsResult =
  | { readonly kind: 'settings'; readonly effective: EffectiveSettings }
  | { readonly kind: 'unreadable'; readonly reason: string; readonly revision: RevisionId }

/**
 * What one workspace actually renders with, resolved down ADR-028's table.
 *
 * The workspace's own file is optional and the organisation's is not, so a
 * workspace whose file is unreadable falls back to inheriting rather than
 * taking the whole page down: an override nobody can read is exactly a
 * workspace that has not set one.
 */
export async function readEffectiveSettings(
  deps: SettingsDependencies,
  workspaceId: WorkspaceId,
): Promise<EffectiveSettingsResult> {
  const organisation = await readOrganisationSettings(deps)
  if (organisation.kind === 'unreadable') return organisation
  const workspace = await deps.settings.readWorkspace(workspaceId)
  return {
    kind: 'settings',
    effective: resolveEffectiveSettings(
      organisation.document,
      workspace.kind === 'settings' ? workspace.document : null,
    ),
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface UpdateSettingsCommand<T> {
  /** The whole document, as the form holds it; settings are written whole. */
  readonly document: T
  /** The revision the editor read, or null when it read the defaults. */
  readonly expectedRevision: RevisionId | null
  readonly actor: UserId
  readonly author: ContentAuthor
  readonly changeNote?: string
}

export type UpdateOrganisationSettingsResult =
  | {
      readonly kind: 'updated'
      readonly document: OrganisationSettings
      readonly revision: RevisionId
      /** Advisory: every colour rule's verdict, with the reason (ADR-028). */
      readonly report: ThemeReport
    }
  | { readonly kind: 'invalid'; readonly issues: readonly SettingsIssue[] }
  | { readonly kind: 'conflict'; readonly current: ReadSettingsResult<OrganisationSettings> }

export async function updateOrganisationSettings(
  deps: SettingsDependencies,
  command: UpdateSettingsCommand<unknown>,
): Promise<UpdateOrganisationSettingsResult> {
  const validation = validateOrganisationSettings(command.document)
  if (!validation.valid) return { kind: 'invalid', issues: validation.issues }

  const before = await deps.settings.readOrganisation()
  const written = await deps.settings.writeOrganisation({
    document: validation.document,
    expectedRevision: command.expectedRevision,
    author: command.author,
    ...(command.changeNote === undefined ? {} : { changeNote: command.changeNote }),
  })
  if (written.kind === 'conflict') {
    return {
      kind: 'conflict',
      current: fromRead(written.current, () => defaultOrganisationSettings()),
    }
  }

  await audit(deps, {
    type: SETTINGS_AUDIT_EVENTS.organisationUpdated,
    actorUserId: command.actor,
    targetType: 'organisation',
    targetId: 'organisation',
    metadata: {
      revision: written.revision,
      changed: changedFields(before.kind === 'settings' ? before.document : null, written.document),
    },
  })
  return {
    kind: 'updated',
    document: written.document,
    revision: written.revision,
    // The organisation's own enforcement setting, so the report says
    // "enforced" exactly where this instance treats the rule that way.
    report: runThemeDoctor(written.document.theme, {
      textContrast: written.document.policies.contrastEnforcement,
    }),
  }
}

export type UpdateWorkspaceSettingsResult =
  | {
      readonly kind: 'updated'
      readonly document: WorkspaceSettings
      readonly revision: RevisionId
    }
  | { readonly kind: 'invalid'; readonly issues: readonly SettingsIssue[] }
  | { readonly kind: 'conflict'; readonly current: ReadSettingsResult<WorkspaceSettings> }
  /** The organisation locked layout, so this workspace may not set one. */
  | { readonly kind: 'layout-locked' }
  /** The organisation's own file cannot be read, so no policy can be applied. */
  | {
      readonly kind: 'organisation-unreadable'
      readonly reason: string
      readonly revision: RevisionId
    }

export async function updateWorkspaceSettings(
  deps: SettingsDependencies,
  workspaceId: WorkspaceId,
  command: UpdateSettingsCommand<unknown>,
): Promise<UpdateWorkspaceSettingsResult> {
  const validation = validateWorkspaceSettings(command.document)
  if (!validation.valid) return { kind: 'invalid', issues: validation.issues }
  if (validation.document.workspaceId !== workspaceId) {
    return {
      kind: 'invalid',
      issues: [
        {
          path: '/workspaceId',
          message: 'the settings document names a different workspace',
          rule: 'workspace-mismatch',
        },
      ],
    }
  }

  const organisation = await readOrganisationSettings(deps)
  if (organisation.kind === 'unreadable') {
    return {
      kind: 'organisation-unreadable',
      reason: organisation.reason,
      revision: organisation.revision,
    }
  }
  // Locked means the organisation decides, so an override is refused rather
  // than accepted and quietly ignored on the way out (ADR-028).
  if (organisation.document.layout.locked && validation.document.layout !== undefined) {
    return { kind: 'layout-locked' }
  }

  const written = await deps.settings.writeWorkspace(workspaceId, {
    document: validation.document,
    expectedRevision: command.expectedRevision,
    author: command.author,
    ...(command.changeNote === undefined ? {} : { changeNote: command.changeNote }),
  })
  if (written.kind === 'conflict') {
    return {
      kind: 'conflict',
      current: fromRead(written.current, () => defaultWorkspaceSettings(workspaceId)),
    }
  }

  await audit(deps, {
    type: SETTINGS_AUDIT_EVENTS.workspaceUpdated,
    actorUserId: command.actor,
    targetType: 'workspace',
    targetId: workspaceId,
    metadata: { revision: written.revision, layout: written.document.layout ?? null },
  })
  return { kind: 'updated', document: written.document, revision: written.revision }
}

/**
 * The top-level fields that changed, for the audit row.
 *
 * Names, not values: a theme is a large document and an audit trail is not a
 * backup of it. What an administrator needs from an audit row is "who changed
 * the policies, and when", and the revision beside it is the whole before and
 * after, in the content store, for free.
 */
function changedFields<T extends object>(before: T | null, after: T): readonly string[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].toSorted()
  return keys.filter(
    (key) =>
      JSON.stringify((before as Record<string, unknown> | null)?.[key]) !==
      JSON.stringify((after as Record<string, unknown>)[key]),
  )
}

async function audit(
  deps: SettingsDependencies,
  event: {
    readonly type: string
    readonly actorUserId: UserId
    readonly targetType: string
    readonly targetId: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): Promise<void> {
  await deps.uow.repos.audit.write({
    id: deps.ids.uuid(),
    type: event.type,
    actorUserId: event.actorUserId,
    targetType: event.targetType,
    targetId: event.targetId,
    metadata: event.metadata,
    now: deps.clock.now(),
  })
}
