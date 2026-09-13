import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'

import { Button, Callout, Dialog, Input, Spinner, Tree, type TreeSection } from '@quill/ui'

import {
  usePublishedContent,
  useCreateCollection,
  useCreateDocument,
  useWorkspaceTree,
  type TreeCollectionDto,
} from '../../lib/api/index.ts'
import {
  answersToSend,
  defaultAnswers,
  readTemplateDeclaration,
  TEMPLATE_COLLECTION_SLUG,
} from '../../lib/documents/template-declaration.ts'
import { FormError } from '../../lib/forms/form-error.tsx'
import { documentReference } from '../../lib/routing/document-reference.ts'
import { SelectField } from '../../lib/forms/select-field.tsx'
import { TemplateQuestions, type TemplateAnswers } from './template-questions.tsx'

export interface NewDocumentDialogProps {
  readonly workspaceId: string
  readonly workspaceSlug: string
  /** Uncontrolled mode: the element that opens the dialog. */
  readonly trigger?: ReactNode
  /**
   * Controlled mode, for the entry points with no trigger element of their
   * own to attach to (the sidebar's "New", a collection's "+", a tree row's
   * "New child document", the `c` shortcut — all in `workspace-navigation.tsx`).
   * Omit both and drive `trigger` instead for an ordinary "click to open".
   */
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** Preselects the collection — a collection's own "+", or a child document's parent's collection. */
  readonly initialCollectionId?: string
  /** Preselects the parent document — "New child document". */
  readonly initialParentId?: string
}

interface TemplateChoice {
  readonly id: string
  readonly title: string
}

type ApiTreeNode = TreeCollectionDto['documents'][number]

/** No document is `''`'s own id, so it doubles as the tree picker's "top level" node. */
const NO_PARENT = ''

function toParentPickerNode(node: ApiTreeNode): TreeSection['nodes'][number] {
  return { id: node.id, label: node.title, children: node.children.map(toParentPickerNode) }
}

/**
 * The workspace's templates: the published documents of its Templates
 * collection (ADR-029). A workspace without that collection simply has none,
 * and the picker is not shown at all.
 */
function templatesIn(collections: readonly TreeCollectionDto[]): readonly TemplateChoice[] {
  const templates = collections.find((collection) => collection.slug === TEMPLATE_COLLECTION_SLUG)
  return (templates?.documents ?? []).flatMap(function flatten(node): readonly TemplateChoice[] {
    return [
      ...(node.status === 'published' ? [{ id: node.id, title: node.title }] : []),
      ...node.children.flatMap(flatten),
    ]
  })
}

/**
 * Creating a document: blank, or from one of the workspace's templates.
 *
 * The collection is a picker sourced from `GET /workspaces/:id/tree`, the only
 * route that lists collections; there is still no route to *create* one, so a
 * workspace with none cannot have a document created in it through this
 * dialog. Templates come from the same tree, and a chosen template's
 * questions come from the document it is — ADR-029 makes a template an
 * ordinary published document, which is what lets both work with no route of
 * their own.
 *
 * Reachable from several places (`workspace-navigation.tsx`'s "New", a
 * collection's "+", a tree row's "New child document", `document-page.tsx`'s
 * header, the `c` shortcut) rather than duplicated per entry point: `trigger`
 * covers the ordinary click-to-open case, and `open`/`onOpenChange` cover
 * everywhere else, with `initialCollectionId`/`initialParentId` presetting
 * the destination the entry point already knows.
 */
export function NewDocumentDialog({
  workspaceId,
  workspaceSlug,
  trigger,
  open: openProp,
  onOpenChange: onOpenChangeProp,
  initialCollectionId,
  initialParentId,
}: NewDocumentDialogProps) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const [title, setTitle] = useState('')
  const [collectionId, setCollectionId] = useState(initialCollectionId ?? '')
  const [parentId, setParentId] = useState(initialParentId ?? NO_PARENT)
  const [templateId, setTemplateId] = useState('')
  const [answers, setAnswers] = useState<TemplateAnswers>({})
  const [newCollectionName, setNewCollectionName] = useState('')
  const tree = useWorkspaceTree(open ? workspaceId : undefined)
  const template = usePublishedContent(templateId === '' ? undefined : templateId)
  const createDocument = useCreateDocument()
  const createCollection = useCreateCollection()
  const navigate = useNavigate()

  const collections = tree.data?.collections ?? []
  const templates = templatesIn(collections)
  const declaration = readTemplateDeclaration(template.data?.frontMatter)
  // Nothing interactive is inert (docs/design/feedback.md): rather than leave
  // Create disabled with no visible reason, a sensible collection is already
  // chosen — the one this dialog was opened for, else the workspace's first —
  // the moment collections exist, without a separate "why is this disabled"
  // explanation to keep in sync. A derived value, not state kept in sync by
  // an effect (AGENTS.md rule 6): explicitly choosing a different collection
  // still wins, since that goes through `collectionId` itself.
  const effectiveCollectionId =
    collectionId !== '' ? collectionId : (initialCollectionId ?? collections[0]?.id ?? '')
  const parentCandidates =
    collections.find((collection) => collection.id === effectiveCollectionId)?.documents ?? []

  function chooseTemplate(nextTemplateId: string) {
    setTemplateId(nextTemplateId)
    // Answers belong to the template that asked for them; carrying them
    // across would silently answer a different question with the same id.
    setAnswers({})
  }

  function handleCreateCollection() {
    const name = newCollectionName.trim()
    if (name === '') return
    createCollection.mutate(
      { workspaceId, name },
      {
        onSuccess: (collection) => {
          setNewCollectionName('')
          setCollectionId(collection.id)
        },
      },
    )
  }

  function resetToPreset() {
    setTitle('')
    setCollectionId(initialCollectionId ?? '')
    setParentId(initialParentId ?? NO_PARENT)
    chooseTemplate('')
  }

  function handleOpenChange(next: boolean) {
    setOpenState(next)
    onOpenChangeProp?.(next)
    // Each entry point represents a fixed destination ("New" in Guides",
    // "New child of this document"); every close resets the form back to
    // that preset, so the *next* open — whether or not it is the same
    // instance, since a controlled caller keys it by preset
    // (`workspace-navigation.tsx`) — never shows a cancelled attempt's
    // leftovers. Closing is also what the primitive actually calls back for:
    // a controlled `open` prop flipping true from the outside is not.
    if (!next) resetToPreset()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (effectiveCollectionId === '') return
    const sent = answersToSend(declaration, { ...defaultAnswers(declaration), ...answers })
    createDocument.mutate(
      {
        workspaceId,
        title,
        collectionId: effectiveCollectionId,
        ...(parentId === NO_PARENT ? {} : { parentId }),
        ...(templateId === '' ? {} : { templateId, answers: sent }),
      },
      {
        onSuccess: (result) => {
          handleOpenChange(false)
          void navigate({
            to: '/w/$workspaceSlug/d/$documentId',
            params: { workspaceSlug, documentId: documentReference(result.document) },
          })
        },
      },
    )
  }

  return (
    <Dialog
      title="New document"
      description="Give it a title and a collection to sit in."
      trigger={trigger}
      open={open}
      onOpenChange={handleOpenChange}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              handleOpenChange(false)
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-document-form"
            loading={createDocument.isPending}
            disabled={title.trim() === '' || effectiveCollectionId === ''}
          >
            Create
          </Button>
        </>
      }
    >
      <form
        id="new-document-form"
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        noValidate
      >
        <Input
          label="Title"
          name="title"
          required
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
          }}
        />

        {collections.length === 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
            <Callout tone="warning" title="No collections yet">
              This workspace has no collections to put a document in yet. Create one to continue.
            </Callout>
            <div className="flex items-end gap-2">
              <Input
                label="New collection"
                value={newCollectionName}
                onChange={(event) => {
                  setNewCollectionName(event.target.value)
                }}
                className="flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                loading={createCollection.isPending}
                disabled={newCollectionName.trim() === ''}
                onClick={handleCreateCollection}
              >
                Create collection
              </Button>
            </div>
            <FormError error={createCollection.error} />
          </div>
        ) : (
          <SelectField
            label="Collection"
            name="collectionId"
            required
            value={effectiveCollectionId}
            onChange={(event) => {
              setCollectionId(event.target.value)
              setParentId(NO_PARENT)
            }}
          >
            <option value="" disabled>
              Choose a collection
            </option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </SelectField>
        )}

        {parentCandidates.length === 0 ? undefined : (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-foreground">Parent document (optional)</p>
            <Tree
              label="Choose a parent document"
              sections={[
                {
                  id: effectiveCollectionId,
                  label:
                    collections.find((collection) => collection.id === effectiveCollectionId)
                      ?.name ?? '',
                  nodes: [
                    { id: NO_PARENT, label: 'No parent (top level)' },
                    ...parentCandidates.map(toParentPickerNode),
                  ],
                },
              ]}
              selectable
              selectedId={parentId}
              onSelect={setParentId}
            />
          </div>
        )}

        {templates.length === 0 ? undefined : (
          <SelectField
            label="Start from"
            name="templateId"
            description="A template scaffolds the document. Every part of it can be changed afterwards."
            value={templateId}
            onChange={(event) => {
              chooseTemplate(event.target.value)
            }}
          >
            <option value="">Blank document</option>
            {templates.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title}
              </option>
            ))}
          </SelectField>
        )}

        {template.isPending && templateId !== '' ? <Spinner className="size-4" /> : undefined}

        {declaration === null ? undefined : (
          <TemplateQuestions
            declaration={declaration}
            answers={{ ...defaultAnswers(declaration), ...answers }}
            onChange={(id, answer) => {
              setAnswers((current) => ({ ...current, [id]: answer }))
            }}
          />
        )}

        <FormError error={createDocument.error} />
      </form>
    </Dialog>
  )
}
