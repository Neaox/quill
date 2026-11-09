import { checkForgeViewTemplate, defaultForgeViewTemplate, forgeViewUrl } from '@quill/domain'

import type {
  SourceDraftBody,
  SourceSettingsBody,
  WorkspaceSourceDto,
} from '../../lib/api/index.ts'
import { slugify } from '../../lib/documents/slugify.ts'

/**
 * The repository form's state, and the pure rules over it (ADR-061): what a
 * preview is asked for, what saving sends, what is missing before either,
 * and why a repository could not be read, in the words the form shows beside
 * the field it is about.
 *
 * The form never holds a secret's value. A credential is a user name and the
 * *name* of a secret the instance stores (ADR-034), chosen from the list of
 * names; the value is read on the server at each fetch.
 */

/** The user name a GitHub or GitLab token is sent with. */
export const TOKEN_USERNAME = 'x-access-token'

export interface FormCollection {
  /** Stable across edits, for React and for the row's own field ids. */
  readonly key: string
  readonly name: string
  readonly path: string
  /**
   * Its identity (ADR-061): a saved collection keeps its slug when renamed, so
   * a rename never makes another collection. A new one takes its name's.
   */
  readonly slug: string | null
}

export type FormCredential =
  | { readonly kind: 'none' }
  | { readonly kind: 'secret'; readonly username: string; readonly secretName: string }

export interface SourceForm {
  readonly remote: string
  readonly branch: string
  readonly credential: FormCredential
  readonly collections: readonly FormCollection[]
  /** The manifest entry chosen; null for the one named after the workspace, or the only one. */
  readonly manifestEntry: string | null
  readonly history: 'full' | 'head'
  readonly commitMessages: 'subject' | 'none'
  /** Where a link to a repository file the source does not hold goes. */
  readonly outsideLinks: 'forge' | 'text'
  /** The forge's address for a file at a commit; empty to use the one known for the remote's host. */
  readonly viewTemplate: string
  /** The name of the secret the push webhook is signed with; empty for no webhook. */
  readonly webhookSecret: string
}

export const EMPTY_FORM: SourceForm = {
  remote: '',
  branch: 'main',
  credential: { kind: 'none' },
  collections: [],
  manifestEntry: null,
  history: 'full',
  commitMessages: 'subject',
  outsideLinks: 'forge',
  viewTemplate: '',
  webhookSecret: '',
}

/** The form as a saved source fills it. */
export function formFromSource(source: WorkspaceSourceDto): SourceForm {
  return {
    remote: source.remote,
    branch: source.branch,
    credential:
      source.credential === null ? { kind: 'none' } : { kind: 'secret', ...source.credential },
    collections: source.collections.map(({ collectionId, slug, name, path }) => ({
      key: collectionId,
      slug,
      name,
      path,
    })),
    manifestEntry: source.manifestEntry,
    history: source.history === 'head' ? 'head' : 'full',
    commitMessages: source.commitMessages === 'none' ? 'none' : 'subject',
    outsideLinks: source.outsideLinks === 'text' ? 'text' : 'forge',
    viewTemplate: source.viewTemplate ?? '',
    webhookSecret: source.webhookSecret ?? '',
  }
}

/** A collection row's slug: its own when saved, else its name's. */
export function collectionSlug(collection: FormCollection): string {
  return collection.slug ?? slugify(collection.name)
}

/** What a preview reads. Fields are sent as typed, trimmed; the server checks them. */
export function draftBody(form: SourceForm): SourceDraftBody {
  return {
    remote: form.remote.trim(),
    branch: form.branch.trim(),
    credential:
      form.credential.kind === 'none'
        ? null
        : { username: form.credential.username.trim(), secretName: form.credential.secretName },
    collections: form.collections.map((collection) => ({
      slug: collectionSlug(collection),
      name: collection.name.trim(),
      path: collection.path.trim(),
    })),
    manifestEntry: form.manifestEntry,
  }
}

/** What saving sends: every setting the form shows, the source's links and webhook included. */
export function settingsBody(form: SourceForm): SourceSettingsBody {
  const template = form.viewTemplate.trim()
  return {
    ...draftBody(form),
    history: form.history,
    commitMessages: form.commitMessages,
    outsideLinks: form.outsideLinks,
    viewTemplate: template === '' ? null : template,
    webhookSecret: form.webhookSecret === '' ? null : form.webhookSecret,
  }
}

/** Two drafts ask the same question when their bodies are equal. */
export function draftKey(body: SourceDraftBody): string {
  return JSON.stringify(body)
}

/** A field the form can put a message beside. */
export type FormField =
  | 'remote'
  | 'branch'
  | 'credential'
  | 'collections'
  | 'manifestEntry'
  | 'viewTemplate'
  | 'webhookSecret'

export type FieldErrors = Partial<Record<FormField, string>>

/** What must be filled in before the repository can be asked anything. */
export function missingFields(form: SourceForm): FieldErrors {
  const errors: FieldErrors = {}
  if (form.remote.trim() === '') errors.remote = 'Enter the repository’s address.'
  if (form.branch.trim() === '') errors.branch = 'Enter the branch to read.'
  if (form.credential.kind === 'secret') {
    if (form.credential.secretName === '') {
      errors.credential = 'Choose the secret that holds the token.'
    } else if (form.credential.username.trim() === '') {
      errors.credential = 'Enter the user name the token is sent with.'
    }
  }
  const incomplete = form.collections.find(
    (collection) => collection.name.trim() === '' || collection.path.trim() === '',
  )
  if (incomplete !== undefined) {
    errors.collections = 'Give every collection a name and a path, or remove it.'
  }
  return errors
}

/**
 * What is wrong with the forge address typed, said as it is typed; null when
 * it is empty (the host's own address is used) or sound. It does not stop a
 * preview, which does not use it, only a save.
 */
export function viewTemplateProblem(form: SourceForm): string | null {
  const template = form.viewTemplate.trim()
  if (template === '') return null
  const checked = checkForgeViewTemplate(template)
  return checked.ok ? null : checked.error
}

/** Why a repository could not be read, said beside the field that would fix it. */
export interface Unreadable {
  readonly field: FormField | null
  readonly message: string
}

export function describeUnreadable(reason: string, branch: string): Unreadable {
  switch (reason) {
    case 'branch-not-found':
      return { field: 'branch', message: `The repository has no branch “${branch}”.` }
    case 'credential-refused':
      return {
        field: 'credential',
        message:
          'The repository refused access. If it is private, choose a credential; if you chose one, check that its token can read this repository.',
      }
    case 'credential-unavailable':
      return { field: 'credential', message: 'The secret is missing or can’t be opened.' }
    case 'unreachable':
      return {
        field: 'remote',
        message: 'Nothing answered at this address, or there is no repository there.',
      }
    case 'blocked-by-outbound-policy':
      return {
        field: 'remote',
        message:
          'This instance isn’t allowed to reach that host. An operator can allow a private host.',
      }
    case 'remote-not-allowed':
      return {
        field: 'remote',
        message: 'The address must start with https:// and hold no user name or password.',
      }
    case 'invalid-path':
      return { field: 'collections', message: 'A path isn’t allowed. Name a folder or a file.' }
    case 'timeout':
      return {
        field: null,
        message:
          'The repository took longer than a preview waits. Try again, or read fewer folders.',
      }
    case 'output-too-large':
      return { field: null, message: 'The repository sent more than a preview accepts.' }
    case 'git-unavailable':
    case 'git-too-old':
      return {
        field: null,
        message: 'The server can’t run Git 2.49 or later, which reading a repository needs.',
      }
    default:
      return { field: null, message: 'Git couldn’t read the repository.' }
  }
}

/** Why a file under the source's paths is not a page, as a heading for its list. */
export const SKIP_REASONS: Readonly<
  Record<string, { readonly title: string; readonly detail: string }>
> = {
  excluded: {
    title: 'Excluded by the manifest',
    detail: 'The manifest’s exclude list names these.',
  },
  outside: {
    title: 'Not matched by a collection',
    detail: 'They are in a folder that is fetched, but no collection’s path matches them.',
  },
  'too-large': {
    title: 'Too large',
    detail: 'Larger than a page may be, so they aren’t stored.',
  },
  'not-utf8': {
    title: 'Not UTF-8 text',
    detail: 'A page must be UTF-8. Save these as UTF-8 to include them.',
  },
  'symbolic-link': {
    title: 'Symbolic links',
    detail: 'Links are never followed, so what they point to is never read.',
  },
  'not-markdown': {
    title: 'Other files',
    detail: 'Only Markdown files become pages; images a page shows are imported with it.',
  },
}

/** A new, empty collection row. */
export function newCollection(key: string): FormCollection {
  return { key, name: '', path: '', slug: null }
}

/**
 * A collection's name suggested from its path, until somebody types one:
 * `docs/guides` is "Guides".
 */
export function nameFromPath(path: string): string {
  const last = path.trim().replace(/\/+$/u, '').split('/').at(-1) ?? ''
  const words = last
    .replace(/\.(?:md|markdown)$/iu, '')
    .replaceAll(/[-_]+/gu, ' ')
    .trim()
  return words === '' ? '' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/**
 * Where a link to a repository file would go with these settings, for the
 * form to show as a working example: the template given, or the one known
 * for the remote's host; null when links go nowhere (text, or no template).
 */
export function exampleOutsideLink(form: SourceForm, commit: string, path: string): string | null {
  if (form.outsideLinks === 'text') return null
  const template = form.viewTemplate.trim()
  if (template !== '') {
    return checkForgeViewTemplate(template).ok ? forgeViewUrl(template, commit, path) : null
  }
  const known = defaultForgeViewTemplate(form.remote.trim())
  return known === null ? null : forgeViewUrl(known, commit, path)
}
